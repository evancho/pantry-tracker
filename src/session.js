import { ackOutbox, deleteItem, listOutbox, loadAll, saveItem } from './db.js';
import {
  createPantryFolder,
  deletePhotoFile,
  downloadPhotoFile,
  driveConfigured,
  explainDriveError,
  visibleFolderEditors,
  googleProfile,
  listFolderPermissions,
  listRemoteItems,
  readPantryFolder,
  removeFolderPermission,
  ensureGoogleAccess,
  requestGoogleAccess,
  shareFolderWriter,
  signOutGoogle,
  uploadPhotoFile,
  writeRemoteItem,
} from './drive.js';
import { driveFolderLink, mergeHouseholdItems, migrationCandidates, parseDriveFolderId, scopeForList } from './sync.js';

const SKIP_PREFIX = 'pantry-tracker-skip-import:';
const USER_KEY = 'pantry-tracker-google-user';
const FOLDERS_KEY = 'pantry-tracker-drive-folders';
const ACTIVE_KEY = 'pantry-tracker-drive-active';

const status = {
  configured: false,
  user: null,
  households: [],
  activeHouseholdId: null,
  syncing: false,
  message: '',
  pendingLocal: 0,
};

let onStatus = () => {};
let onSynced = () => {};
let started = false;
let syncing = false;

function emit() {
  onStatus();
}

function readFolders() {
  try {
    const rows = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter((row) => row?.id) : [];
  } catch {
    return [];
  }
}

function writeFolders(rows) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(rows));
  status.households = rows;
  const active = localStorage.getItem(ACTIVE_KEY);
  status.activeHouseholdId = rows.some((row) => row.id === active) ? active : (rows[0]?.id || null);
  if (status.activeHouseholdId) localStorage.setItem(ACTIVE_KEY, status.activeHouseholdId);
  else localStorage.removeItem(ACTIVE_KEY);
}

export function getSessionStatus() {
  const active = status.households.find((row) => row.id === status.activeHouseholdId) || null;
  return {
    ...status,
    activeName: active?.name || '',
    role: active?.role || '',
    folderLink: status.activeHouseholdId ? driveFolderLink(status.activeHouseholdId) : '',
    importSkipped: status.activeHouseholdId
      ? localStorage.getItem(SKIP_PREFIX + status.activeHouseholdId) === '1'
      : false,
  };
}

export function activeHouseholdId() {
  return scopeForList({ activeHouseholdId: status.activeHouseholdId });
}

async function refreshPending() {
  status.pendingLocal = (await loadAll(null)).length;
}

function rememberUser(user) {
  status.user = user;
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function startSession({ onStatus: statusHandler, onSynced: syncedHandler }) {
  onStatus = statusHandler || (() => {});
  onSynced = syncedHandler || (() => {});
  status.configured = driveConfigured();
  status.households = readFolders();
  status.activeHouseholdId = status.households.some((row) => row.id === localStorage.getItem(ACTIVE_KEY))
    ? localStorage.getItem(ACTIVE_KEY)
    : (status.households[0]?.id || null);
  if (!status.configured || started) {
    emit();
    return;
  }
  started = true;
  window.addEventListener('online', () => {
    if (!status.user) return;
    ensureGoogleAccess()
      .then(() => syncNow())
      .catch(() => {
        rememberUser(null);
        status.message = '請再按一次「使用 Google 登入」。';
        emit();
        onSynced();
      });
  });
  const remembered = readRememberedUser();
  if (!remembered) {
    emit();
    return;
  }
  if (!navigator.onLine) {
    rememberUser(remembered);
    refreshPending().then(() => {
      emit();
      onSynced();
    });
    return;
  }
  requestGoogleAccess({ prompt: '' })
    .then(() => googleProfile())
    .then(async (profile) => {
      rememberUser(profile);
      await refreshPending();
      emit();
      onSynced();
      await syncNow();
    })
    .catch(() => {
      rememberUser(null);
      status.message = '請再按一次「使用 Google 登入」。這台裝置上的清單仍可查看與修改。';
      emit();
      onSynced();
    });
}

function readRememberedUser() {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    if (!user?.email && !user?.displayName) return null;
    return user;
  } catch {
    return null;
  }
}

async function guard(work) {
  try {
    return await work();
  } catch (error) {
    const message = explainDriveError(error);
    status.message = message;
    emit();
    throw new Error(message);
  }
}

export function signInGoogle() {
  return guard(async () => {
    await requestGoogleAccess({ prompt: 'select_account' });
    const profile = await googleProfile();
    rememberUser(profile);
    writeFolders(readFolders());
    await refreshPending();
    emit();
    onSynced();
    await syncNow();
  });
}

export function signOutUser() {
  return guard(async () => {
    await signOutGoogle();
    rememberUser(null);
    status.message = '';
    await refreshPending();
    emit();
    onSynced();
  });
}

export function createHousehold(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const error = new Error('請輸入資料夾名稱。');
    status.message = error.message;
    emit();
    return Promise.reject(error);
  }
  return guard(async () => {
    const folder = await createPantryFolder(trimmed);
    const rows = readFolders().filter((row) => row.id !== folder.id);
    rows.push(folder);
    localStorage.setItem(ACTIVE_KEY, folder.id);
    writeFolders(rows);
    status.message = `已在 Google 雲端硬碟建立「${folder.name}」。`;
    emit();
    onSynced();
    await syncNow();
  });
}

export function switchHousehold(householdId) {
  return guard(async () => {
    const folder = await readPantryFolder(householdId);
    const rows = readFolders().map((row) => (row.id === folder.id ? folder : row));
    if (!rows.some((row) => row.id === folder.id)) rows.push(folder);
    localStorage.setItem(ACTIVE_KEY, folder.id);
    writeFolders(rows);
    emit();
    onSynced();
    await syncNow();
  });
}

export function joinFolder(link) {
  const folderId = parseDriveFolderId(link);
  if (!folderId) {
    const error = new Error('請貼上 Google 雲端硬碟資料夾連結或資料夾 ID。');
    status.message = error.message;
    emit();
    return Promise.reject(error);
  }
  return guard(async () => {
    const folder = await readPantryFolder(folderId);
    const rows = readFolders().filter((row) => row.id !== folder.id);
    rows.push(folder);
    localStorage.setItem(ACTIVE_KEY, folder.id);
    writeFolders(rows);
    status.message = folder.role === 'reader'
      ? `已開啟「${folder.name}」，但目前只能檢視。請請家人改成分享為編輯者。`
      : `已使用共用資料夾「${folder.name}」。`;
    emit();
    onSynced();
    await syncNow();
  });
}

export function listEditors() {
  return guard(async () => {
    const current = getSessionStatus();
    if (!current.user) throw new Error('請先使用 Google 登入。');
    if (!current.activeHouseholdId) throw new Error('請先建立或選擇資料夾。');
    await ensureGoogleAccess();
    const permissions = await listFolderPermissions(current.activeHouseholdId);
    return visibleFolderEditors(permissions, { selfEmail: current.user.email || '' });
  });
}

export function unshareEditor(permissionId) {
  return guard(async () => {
    const current = getSessionStatus();
    if (!current.user) throw new Error('請先使用 Google 登入。');
    if (!current.activeHouseholdId) throw new Error('請先建立或選擇資料夾。');
    if (!permissionId) throw new Error('找不到這個分享。');
    await ensureGoogleAccess();
    const permissions = await listFolderPermissions(current.activeHouseholdId);
    const target = permissions.find((row) => row.id === permissionId && !row.deleted);
    if (!target) throw new Error('這個分享已經不在了。');
    if (target.role === 'owner') throw new Error('無法取消擁有者的分享。');
    if (target.type !== 'user' || target.role !== 'writer') throw new Error('只能取消編輯者的分享。');
    await removeFolderPermission(current.activeHouseholdId, permissionId);
  });
}

export function shareFolder(email) {
  return guard(async () => {
    const current = getSessionStatus();
    if (!current.activeHouseholdId) throw new Error('請先建立或選擇雲端硬碟資料夾。');
    const address = String(email || '').trim();
    if (address) await shareFolderWriter(current.activeHouseholdId, address);
    return {
      link: current.folderLink,
      shared: Boolean(address),
    };
  });
}

export function dismissImport() {
  if (status.activeHouseholdId) localStorage.setItem(SKIP_PREFIX + status.activeHouseholdId, '1');
  emit();
}

export function importLocalPantry() {
  return guard(async () => {
    const householdId = status.activeHouseholdId;
    if (!householdId) throw new Error('請先建立或選擇雲端硬碟資料夾。');
    const moved = migrationCandidates(await loadAll(null), householdId, Date.now());
    for (const item of moved) await saveItem(item, undefined, { queue: true });
    localStorage.removeItem(SKIP_PREFIX + householdId);
    await refreshPending();
    emit();
    onSynced();
    await syncNow();
  });
}

export async function syncNow() {
  if (!status.configured || !status.user || !status.activeHouseholdId || syncing || !navigator.onLine) return;
  const householdId = status.activeHouseholdId;
  syncing = true;
  status.syncing = true;
  emit();
  try {
    await ensureGoogleAccess();
    const remote = await listRemoteItems(householdId);
    const local = await loadAll(householdId);
    const plan = mergeHouseholdItems(local, remote);
    for (const id of plan.dropIds) await deleteItem(id, { queue: false });
    for (const item of plan.items) {
      const previous = local.find((row) => row.id === item.id);
      if (previous && (Number(previous.updatedAt) || 0) >= (Number(item.updatedAt) || 0)) continue;
      let photo;
      if (item.photoPath) {
        const bytes = await downloadPhotoFile(item.photoPath);
        photo = new Blob([bytes], { type: 'image/jpeg' });
      } else {
        photo = null;
      }
      await saveItem({ ...item, householdId }, photo, { queue: false });
    }
    const folder = status.households.find((row) => row.id === householdId);
    if (folder?.role === 'reader') {
      status.message = '已從 Google 雲端硬碟更新。這個資料夾目前只能檢視，這裡的修改會留在這台裝置。';
      onSynced();
      return;
    }
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const fresh = await loadAll(householdId);
    for (const item of fresh) {
      const remoteItem = remoteById.get(item.id);
      if (remoteItem && Number(remoteItem.updatedAt) >= Number(item.updatedAt)) {
        await ackOutbox(`${householdId}:${item.id}`);
        continue;
      }
      let photoPath = item.photoPath || null;
      if (item.photoBlob && item.photoId) {
        photoPath = await uploadPhotoFile(householdId, item.photoId, item.photoBlob);
      } else if (!item.photoId && item.photoPath) {
        await deletePhotoFile(item.photoPath);
        photoPath = null;
      }
      const remoteFileId = await writeRemoteItem(householdId, { ...item, photoPath, deletedAt: null });
      if (photoPath !== item.photoPath || remoteFileId !== item.remoteFileId) {
        await saveItem({ ...item, photoPath, remoteFileId, deletedAt: null }, undefined, { queue: false });
      }
      await ackOutbox(`${householdId}:${item.id}`);
    }
    const deletes = (await listOutbox()).filter((row) => row.householdId === householdId && row.op === 'delete');
    for (const row of deletes) {
      const remoteItem = remoteById.get(row.id);
      if (remoteItem?.deletedAt && Number(remoteItem.updatedAt) >= Number(row.updatedAt)) {
        await ackOutbox(row.key);
        continue;
      }
      await writeRemoteItem(householdId, {
        id: row.id,
        remoteFileId: remoteItem?.remoteFileId || null,
        name: '',
        expiry: null,
        area: '冷藏',
        leadDays: 1,
        photoPath: null,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
        deletedAt: row.updatedAt,
      });
      if (row.photoPath) await deletePhotoFile(row.photoPath);
      await ackOutbox(row.key);
    }
    status.message = '已與 Google 雲端硬碟同步';
    onSynced();
  } catch (error) {
    status.message = explainDriveError(error);
    const code = String(error?.code || '');
    if (code === '401' || code === 'interaction_required') {
      rememberUser(null);
      onSynced();
    }
  } finally {
    syncing = false;
    status.syncing = false;
    emit();
  }
}
