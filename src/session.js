import { ackOutbox, deleteItem, listOutbox, loadAll, saveItem } from './db.js';
import { cloud, cloudConfigured, explainCloudError } from './cloud.js';
import { inviteLink, mergeHouseholdItems, migrationCandidates, normalizeInviteCode, parseJoinCode } from './sync.js';

const SKIP_PREFIX = 'pantry-tracker-skip-import:';
const JOIN_KEY = 'pantry-tracker-join';

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

export function getSessionStatus() {
  const active = status.households.find((row) => row.id === status.activeHouseholdId) || null;
  return {
    ...status,
    activeName: active?.name || '',
    role: active?.role || '',
    importSkipped: status.activeHouseholdId
      ? localStorage.getItem(SKIP_PREFIX + status.activeHouseholdId) === '1'
      : false,
  };
}

export function activeHouseholdId() {
  return status.user ? status.activeHouseholdId : null;
}

async function refreshPending() {
  const local = await loadAll(null);
  status.pendingLocal = local.length;
}

async function refreshHouseholds() {
  const listed = await cloud.listHouseholds(status.user);
  status.households = listed.households;
  status.activeHouseholdId = listed.activeHouseholdId;
  await refreshPending();
}

async function consumeJoinCode() {
  const code = sessionStorage.getItem(JOIN_KEY) || parseJoinCode(window.location.search);
  if (!code || !status.user) return;
  sessionStorage.setItem(JOIN_KEY, code);
  try {
    await joinHousehold(code);
    sessionStorage.removeItem(JOIN_KEY);
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch (error) {
    status.message = explainCloudError(error);
  }
}

export function startSession({ onStatus: statusHandler, onSynced: syncedHandler }) {
  onStatus = statusHandler || (() => {});
  onSynced = syncedHandler || (() => {});
  status.configured = cloudConfigured();
  const pending = parseJoinCode(window.location.search);
  if (pending) sessionStorage.setItem(JOIN_KEY, pending);
  if (!status.configured || started) {
    emit();
    return;
  }
  started = true;
  const authEvents = cloud.listen(async (user) => {
    status.user = user;
    status.message = '';
    if (!user) {
      status.households = [];
      status.activeHouseholdId = null;
      await refreshPending();
      emit();
      onSynced();
      return;
    }
    try {
      await refreshHouseholds();
      await consumeJoinCode();
    } catch (error) {
      status.message = explainCloudError(error);
    }
    emit();
    onSynced();
    syncNow().catch(() => {});
  });
  authEvents.ready.catch((error) => {
    status.message = explainCloudError(error);
    emit();
  });
  window.addEventListener('online', () => {
    syncNow().catch(() => {});
  });
}

async function guard(work) {
  try {
    return await work();
  } catch (error) {
    const message = explainCloudError(error);
    status.message = message;
    emit();
    throw new Error(message);
  }
}

export function signInGoogle() {
  return guard(() => cloud.signInGoogle());
}

export function signInEmail(email, password) {
  return guard(() => cloud.signInEmail(email.trim(), password));
}

export function signUpEmail(email, password) {
  if (String(password || '').length < 6) {
    const error = new Error('密碼至少需要 6 個字元。');
    status.message = error.message;
    emit();
    return Promise.reject(error);
  }
  return guard(() => cloud.signUpEmail(email.trim(), password));
}

export function signOutUser() {
  return guard(() => cloud.signOut());
}

export function createHousehold(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const error = new Error('請輸入家庭名稱。');
    status.message = error.message;
    emit();
    return Promise.reject(error);
  }
  return guard(async () => {
    await cloud.createHousehold(status.user, trimmed);
    await refreshHouseholds();
    emit();
    onSynced();
    await syncNow();
  });
}

export function switchHousehold(householdId) {
  return guard(async () => {
    await cloud.switchHousehold(status.user, householdId);
    status.activeHouseholdId = householdId;
    emit();
    onSynced();
    await syncNow();
  });
}

export function joinHousehold(code) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) {
    const error = new Error('邀請碼是 8 個英數大寫字元。');
    status.message = error.message;
    emit();
    return Promise.reject(error);
  }
  return guard(async () => {
    const invite = await cloud.getInvite(normalized);
    if (!invite || Number(invite.expiresAt) < Date.now()) {
      throw new Error('邀請碼無效或已過期。');
    }
    await cloud.joinHousehold(status.user, invite);
    await refreshHouseholds();
    status.message = `已加入「${invite.householdName || '家庭'}」。`;
    emit();
    onSynced();
    await syncNow();
  });
}

export function createInvite() {
  return guard(async () => {
    const current = getSessionStatus();
    if (!current.activeHouseholdId) throw new Error('請先建立或加入一個家庭。');
    if (current.role !== 'admin') throw new Error('只有管理員可以邀請家人。');
    const code = await cloud.createInvite(status.user, {
      id: current.activeHouseholdId,
      name: current.activeName,
    });
    return {
      code,
      link: inviteLink(window.location.origin, import.meta.env.BASE_URL, code),
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
    if (!householdId) throw new Error('請先建立或加入一個家庭。');
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
    const remote = await cloud.listIngredients(householdId);
    const local = await loadAll(householdId);
    const plan = mergeHouseholdItems(local, remote);
    for (const id of plan.dropIds) await deleteItem(id, { queue: false });
    for (const item of plan.items) {
      const previous = local.find((row) => row.id === item.id);
      if (previous && (Number(previous.updatedAt) || 0) >= (Number(item.updatedAt) || 0)) continue;
      let photo;
      if (item.photoPath) {
        const bytes = await cloud.downloadPhoto(item.photoPath);
        photo = new Blob([bytes], { type: 'image/jpeg' });
      } else {
        photo = null;
      }
      await saveItem({ ...item, householdId }, photo, { queue: false });
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
        photoPath = await cloud.uploadPhoto(householdId, item.photoId, item.photoBlob);
      } else if (!item.photoId && item.photoPath) {
        await cloud.deletePhoto(item.photoPath);
        photoPath = null;
      }
      const next = { ...item, photoPath, deletedAt: null };
      await cloud.writeIngredient(next);
      if (photoPath !== item.photoPath) await saveItem(next, undefined, { queue: false });
      await ackOutbox(`${householdId}:${item.id}`);
    }
    const deletes = (await listOutbox()).filter((row) => row.householdId === householdId && row.op === 'delete');
    for (const row of deletes) {
      const remoteItem = remoteById.get(row.id);
      if (remoteItem?.deletedAt && Number(remoteItem.updatedAt) >= Number(row.updatedAt)) {
        await ackOutbox(row.key);
        continue;
      }
      await cloud.writeIngredient({
        id: row.id,
        householdId,
        name: '',
        expiry: null,
        area: '冷藏',
        leadDays: 1,
        photoPath: null,
        createdAt: row.updatedAt,
        updatedAt: row.updatedAt,
        deletedAt: row.updatedAt,
      });
      if (row.photoPath) await cloud.deletePhoto(row.photoPath);
      await ackOutbox(row.key);
    }
    status.message = '已同步';
    onSynced();
  } catch (error) {
    status.message = explainCloudError(error);
  } finally {
    syncing = false;
    status.syncing = false;
    emit();
  }
}
