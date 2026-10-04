import { ackOutbox, deleteItem, listOutbox, loadAll, saveItem } from './db.js';
import {
  createPantryFolder,
  deleteDriveFile,
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
  clearGoogleToken,
  ensureGoogleAccess,
  requestGoogleAccess,
  readLineSubscribersFile,
  shareFolderWriter,
  signOutGoogle,
  uploadPhotoFile,
  writeLineSubscribersFile,
  writeRemoteItem,
} from './drive.js';
import {
  addLineSubscriber,
  normalizeLineUserId,
  parseLineSubscribers,
  removeLineSubscriber,
  serializeLineSubscribers,
  setLineEnabled,
} from './line-subscribers.js';
import { buttonAuthSteps, isUserCancel, reauthCopy, silentAuthPrompt } from './auth-restore.js';
import { driveFolderLink, migrationCandidates, parseDriveFolderId, reconcileHousehold, scopeForList } from './sync.js';

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
  needsReauth: false,
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

function requireAuthorized() {
  if (!status.user || status.needsReauth) {
    throw new Error('請再按一次「使用 Google 登入」。');
  }
}

function currentFolderName() {
  return status.households.find((row) => row.id === status.activeHouseholdId)?.name || '';
}

function keepRememberedAccount(user) {
  clearGoogleToken();
  rememberUser(user);
  status.needsReauth = true;
  status.message = reauthCopy(user, currentFolderName());
}

async function requestButtonAccess(email) {
  const steps = buttonAuthSteps(email);
  let lastError = null;
  for (const step of steps) {
    try {
      return await requestGoogleAccess(step);
    } catch (error) {
      lastError = error;
      if (isUserCancel(error)) throw error;
    }
  }
  throw lastError;
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
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (!status.user) return;
      requestGoogleAccess({ prompt: silentAuthPrompt(), hint: status.user.email || '' })
        .then(() => {
          status.needsReauth = false;
          return syncNow();
        })
        .catch(() => {
          keepRememberedAccount(status.user);
          emit();
          onSynced();
        });
    });
  }
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
  requestGoogleAccess({ prompt: silentAuthPrompt(), hint: remembered.email || '' })
    .then(() => googleProfile())
    .then(async (profile) => {
      rememberUser(profile);
      status.needsReauth = false;
      await refreshPending();
      emit();
      onSynced();
      await syncNow();
    })
    .catch(() => {
      keepRememberedAccount(remembered);
      refreshPending().then(() => {
        emit();
        onSynced();
      });
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
    const hinted = status.user?.email || readRememberedUser()?.email || '';
    await requestButtonAccess(hinted);
    const profile = await googleProfile();
    rememberUser(profile);
    status.needsReauth = false;
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
    status.needsReauth = false;
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
    requireAuthorized();
    const current = getSessionStatus();
    if (!current.user) throw new Error('請先使用 Google 登入。');
    if (!current.activeHouseholdId) throw new Error('請先建立或選擇資料夾。');
    await ensureGoogleAccess({ prompt: '', hint: status.user?.email || '' });
    const permissions = await listFolderPermissions(current.activeHouseholdId);
    return visibleFolderEditors(permissions, { selfEmail: current.user.email || '' });
  });
}

export function unshareEditor(permissionId) {
  return guard(async () => {
    requireAuthorized();
    const current = getSessionStatus();
    if (!current.user) throw new Error('請先使用 Google 登入。');
    if (!current.activeHouseholdId) throw new Error('請先建立或選擇資料夾。');
    if (!permissionId) throw new Error('找不到這個分享。');
    await ensureGoogleAccess({ prompt: '', hint: status.user?.email || '' });
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
    requireAuthorized();
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

async function currentLineDoc() {
  requireAuthorized();
  if (!status.activeHouseholdId) throw new Error('請先建立或加入資料夾。LINE 綁定會存在這個雲端硬碟資料夾。');
  await ensureGoogleAccess({ prompt: '', hint: status.user?.email || '' });
  return parseLineSubscribers(await readLineSubscribersFile(status.activeHouseholdId));
}

async function storeLineDoc(doc) {
  await writeLineSubscribersFile(status.activeHouseholdId, serializeLineSubscribers(doc));
  return doc;
}

export function loadLineBinding() {
  return guard(async () => currentLineDoc());
}

export function saveLineSubscriber({ userId, label } = {}) {
  return guard(async () => {
    const id = normalizeLineUserId(userId);
    if (!id) throw new Error('請貼上 U 開頭的 LINE userId。');
    const current = await currentLineDoc();
    const result = addLineSubscriber(current, { userId: id, label });
    if (!result.ok && result.reason === 'duplicate') throw new Error('這個 LINE userId 已經綁定。');
    if (!result.ok) throw new Error('請貼上 U 開頭的 LINE userId。');
    return storeLineDoc(result.doc);
  });
}

export function removeLineSubscriberBinding(userId) {
  return guard(async () => {
    const current = await currentLineDoc();
    return storeLineDoc(removeLineSubscriber(current, userId));
  });
}

export function setLineRemindersEnabled(enabled) {
  return guard(async () => {
    const current = await currentLineDoc();
    return storeLineDoc(setLineEnabled(current, enabled));
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

async function outboxFor(householdId) {
  return (await listOutbox()).filter((row) => row.householdId === householdId);
}

async function outboxRow(householdId, id) {
  const rows = await outboxFor(householdId);
  return rows.find((row) => row.id === id) || null;
}

async function ackIf(householdId, id, op, updatedAt) {
  const row = await outboxRow(householdId, id);
  if (!row || row.op !== op) return;
  if (updatedAt != null && Number(row.updatedAt) > Number(updatedAt)) return;
  await ackOutbox(row.key);
}

async function householdPlan(householdId, remoteItems) {
  let localItems = await loadAll(householdId);
  const pending = await outboxFor(householdId);
  const staleEdit = pending.some((row) => {
    if (row.op !== 'upsert') return false;
    const local = localItems.find((item) => item.id === row.id);
    return (Number(row.updatedAt) || 0) > (Number(local?.updatedAt) || 0);
  });
  if (staleEdit) localItems = await loadAll(householdId);
  return reconcileHousehold({ localItems, remoteItems, pending });
}

function noteRemoteVersion(remoteItems, item, extra) {
  const rest = remoteItems.filter((row) => row.id !== item.id);
  rest.push({
    id: item.id,
    name: item.name || '',
    expiry: item.expiry ?? null,
    area: item.area || '冷藏',
    leadDays: item.leadDays ?? 1,
    photoId: item.photoId || null,
    photoPath: extra.photoPath ?? null,
    remoteFileId: extra.remoteFileId || item.remoteFileId || null,
    householdId: extra.householdId || item.householdId || null,
    createdAt: item.createdAt || extra.updatedAt || item.updatedAt,
    updatedAt: extra.updatedAt ?? item.updatedAt,
    deletedAt: extra.deletedAt ?? null,
  });
  return rest;
}

async function applyDrops(householdId, remoteItems) {
  const seen = new Set();
  for (let guard = 0; guard < 40; guard += 1) {
    const plan = await householdPlan(householdId, remoteItems);
    const id = plan.dropIds.find((rowId) => !seen.has(rowId));
    if (!id) return;
    seen.add(id);
    const again = await householdPlan(householdId, remoteItems);
    if (!again.dropIds.includes(id)) continue;
    await deleteItem(id, { queue: false });
  }
}

async function applyPulls(householdId, remoteItems) {
  const seen = new Set();
  for (let guard = 0; guard < 40; guard += 1) {
    const plan = await householdPlan(householdId, remoteItems);
    const item = plan.pull.find((row) => !seen.has(row.id));
    if (!item) return;
    seen.add(item.id);
    const again = await householdPlan(householdId, remoteItems);
    const still = again.pull.find((row) => row.id === item.id && Number(row.updatedAt) === Number(item.updatedAt));
    if (!still) continue;
    const pending = await outboxRow(householdId, still.id);
    if (pending?.op === 'delete' && Number(pending.updatedAt) >= Number(still.updatedAt)) continue;
    if (pending?.op === 'upsert' && Number(pending.updatedAt) > Number(still.updatedAt)) continue;
    let photo;
    if (still.photoPath) {
      const bytes = await downloadPhotoFile(still.photoPath);
      photo = new Blob([bytes], { type: 'image/jpeg' });
    } else {
      photo = null;
    }
    await saveItem({ ...still, householdId, deletedAt: null }, photo, { queue: false });
  }
}

async function ackSettled(householdId, remoteItems) {
  const plan = await householdPlan(householdId, remoteItems);
  const tombstones = new Set(plan.tombstones.map((row) => row.id));
  const pushing = new Set(plan.push.map((row) => row.id));
  for (const entry of plan.ackUpserts) {
    if (pushing.has(entry.id)) continue;
    await ackIf(householdId, entry.id, 'upsert', entry.updatedAt);
  }
  for (const entry of plan.ackDeletes) {
    if (tombstones.has(entry.id)) continue;
    await ackIf(householdId, entry.id, 'delete', entry.updatedAt);
  }
}

export async function syncNow() {
  if (!status.configured || !status.user || status.needsReauth || !status.activeHouseholdId || syncing || !navigator.onLine) return;
  const householdId = status.activeHouseholdId;
  syncing = true;
  status.syncing = true;
  emit();
  try {
    await ensureGoogleAccess({ prompt: '', hint: status.user?.email || '' });
    let remoteView = await listRemoteItems(householdId);
    const initial = await householdPlan(householdId, remoteView);
    const staleFileIds = initial.staleFileIds || [];
    await applyDrops(householdId, remoteView);
    await applyPulls(householdId, remoteView);
    const folder = status.households.find((row) => row.id === householdId);
    if (folder?.role === 'reader') {
      await ackSettled(householdId, remoteView);
      status.message = '已從 Google 雲端硬碟更新。這個資料夾目前只能檢視，這裡的修改會留在這台裝置。';
      onSynced();
      return;
    }
    await ackSettled(householdId, remoteView);
    const written = new Map();
    const attempted = new Set();
    for (let guard = 0; guard < 40; guard += 1) {
      const plan = await householdPlan(householdId, remoteView);
      const item = plan.push.find((row) => !attempted.has(`${row.id}:${Number(row.updatedAt) || 0}`));
      if (!item) break;
      attempted.add(`${item.id}:${Number(item.updatedAt) || 0}`);
      const pending = await outboxRow(householdId, item.id);
      if (pending?.op === 'delete' && Number(pending.updatedAt) >= Number(item.updatedAt)) continue;
      if (pending?.op === 'upsert' && Number(pending.updatedAt) > Number(item.updatedAt)) continue;
      let photoPath = item.photoPath || null;
      if (item.photoBlob && item.photoId) {
        photoPath = await uploadPhotoFile(householdId, item.photoId, item.photoBlob);
      } else if (!item.photoId && item.photoPath) {
        await deletePhotoFile(item.photoPath);
        photoPath = null;
      }
      const pendingAgain = await outboxRow(householdId, item.id);
      if (pendingAgain?.op === 'delete' && Number(pendingAgain.updatedAt) >= Number(item.updatedAt)) continue;
      if (pendingAgain?.op === 'upsert' && Number(pendingAgain.updatedAt) > Number(item.updatedAt)) continue;
      const currentRow = (await loadAll(householdId)).find((row) => row.id === item.id);
      if (!currentRow || Number(currentRow.updatedAt) !== Number(item.updatedAt)) continue;
      const remoteFileId = await writeRemoteItem(householdId, {
        ...currentRow,
        photoPath,
        remoteFileId: currentRow.remoteFileId || item.remoteFileId || null,
        deletedAt: null,
      });
      written.set(item.id, remoteFileId);
      remoteView = noteRemoteVersion(remoteView, currentRow, {
        remoteFileId,
        photoPath,
        updatedAt: currentRow.updatedAt,
        deletedAt: null,
        householdId,
      });
      await saveItem({
        ...currentRow,
        householdId,
        photoPath,
        remoteFileId,
        deletedAt: null,
      }, undefined, { queue: false });
      await ackIf(householdId, item.id, 'upsert', currentRow.updatedAt);
    }
    const deleteAttempts = new Set();
    for (let guard = 0; guard < 40; guard += 1) {
      const plan = await householdPlan(householdId, remoteView);
      const tombstone = plan.tombstones.find((row) => !deleteAttempts.has(`${row.id}:${row.updatedAt}`));
      if (!tombstone) {
        for (const entry of plan.ackDeletes) await ackIf(householdId, entry.id, 'delete', entry.updatedAt);
        break;
      }
      deleteAttempts.add(`${tombstone.id}:${tombstone.updatedAt}`);
      const current = await outboxRow(householdId, tombstone.id);
      if (!current || current.op !== 'delete' || Number(current.updatedAt) !== Number(tombstone.updatedAt)) continue;
      const latest = (await loadAll(householdId)).find((row) => row.id === current.id);
      if (latest && Number(latest.updatedAt) > Number(current.updatedAt)) continue;
      const remoteFileId = await writeRemoteItem(householdId, {
        id: current.id,
        remoteFileId: tombstone.remoteFileId || written.get(current.id) || null,
        name: tombstone.name || '',
        expiry: tombstone.expiry ?? null,
        area: tombstone.area || '冷藏',
        leadDays: tombstone.leadDays ?? 1,
        photoPath: null,
        createdAt: tombstone.createdAt || current.updatedAt,
        updatedAt: current.updatedAt,
        deletedAt: current.updatedAt,
      });
      const photoPath = current.photoPath || tombstone.photoPath;
      if (photoPath) await deletePhotoFile(photoPath);
      await deleteItem(current.id, { queue: false });
      remoteView = noteRemoteVersion(remoteView, tombstone, {
        remoteFileId,
        photoPath: null,
        updatedAt: current.updatedAt,
        deletedAt: current.updatedAt,
        householdId,
      });
      await ackIf(householdId, current.id, 'delete', current.updatedAt);
    }
    const keepFiles = new Set(written.values());
    for (const fileId of staleFileIds) {
      if (!fileId || keepFiles.has(fileId)) continue;
      await deleteDriveFile(fileId);
    }
    status.message = '已與 Google 雲端硬碟同步';
    onSynced();
  } catch (error) {
    const code = String(error?.code || '');
    if (code === '401' || code === 'interaction_required' || code === 'popup_blocked_by_browser') {
      keepRememberedAccount(status.user);
    } else {
      status.message = explainDriveError(error);
    }
    onSynced();
  } finally {
    syncing = false;
    status.syncing = false;
    emit();
  }
}
