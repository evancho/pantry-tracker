export function lastWriteWins(local, remote) {
  const localAt = Number(local?.updatedAt) || 0;
  const remoteAt = Number(remote?.updatedAt) || 0;
  if (remoteAt > localAt) return 'remote';
  if (localAt > remoteAt) return 'local';
  return 'tie';
}

function remoteTombstoneWins(local, remote) {
  if (!remote?.deletedAt) return false;
  return Number(remote.deletedAt) >= (Number(local?.updatedAt) || 0);
}

export function mergeHouseholdItems(localItems, remoteItems) {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const remoteById = new Map(remoteItems.map((item) => [item.id, item]));
  const items = [];
  const pushIds = [];
  const dropIds = [];

  for (const id of new Set([...localById.keys(), ...remoteById.keys()])) {
    const local = localById.get(id);
    const remote = remoteById.get(id);
    if (!remote) {
      if (local) {
        items.push(local);
        pushIds.push(id);
      }
      continue;
    }
    if (!local) {
      if (!remote.deletedAt) {
        items.push({
          ...remote,
          photoMissing: Boolean(remote.photoPath),
        });
      }
      continue;
    }
    if (remoteTombstoneWins(local, remote)) {
      dropIds.push(id);
      continue;
    }
    const winner = lastWriteWins(local, remote);
    if (winner === 'remote') {
      const samePhoto = remote.photoPath && remote.photoPath === local.photoPath;
      items.push({
        ...remote,
        photoBlob: samePhoto ? local.photoBlob || null : null,
        photoId: samePhoto ? local.photoId || remote.photoId || null : remote.photoId || null,
        photoMissing: Boolean(remote.photoPath) && !samePhoto,
      });
    } else {
      items.push(local);
      if (winner === 'local') pushIds.push(id);
    }
  }

  return { items, pushIds, dropIds };
}

export function parseDriveFolderId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const folder = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folder) return folder[1];
  const query = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (query) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return '';
}

export function driveFolderLink(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function scopeForList({ activeHouseholdId } = {}) {
  return activeHouseholdId || null;
}

export function syncStatusLabel({
  configured = false,
  user = null,
  activeHouseholdId = null,
  syncing = false,
  message = '',
  online = true,
  role = '',
} = {}) {
  if (!online) return { key: 'offline', label: '離線' };
  if (syncing) return { key: 'syncing', label: '同步中' };
  if (!configured) return { key: 'local', label: '只在這台裝置' };
  if (!user) return { key: 'login', label: '需登入才能同步' };
  if (!activeHouseholdId) return { key: 'folder', label: '尚未設定資料夾' };
  const text = String(message || '');
  if (role === 'reader' || /只能檢視/.test(text)) return { key: 'reader', label: '只能檢視' };
  if (/已與 Google 雲端硬碟同步|已從 Google 雲端硬碟更新/.test(text)) return { key: 'synced', label: '已同步' };
  if (text) return { key: 'error', label: '同步未完成' };
  return { key: 'pending', label: '尚未同步' };
}

export function itemsInScope(items, scope) {
  const target = scope || null;
  return (items || []).filter((item) => item && !item.deletedAt && (item.householdId || null) === target);
}

export function migrationCandidates(localItems, householdId, now) {
  return localItems
    .filter((item) => item && !item.householdId && !item.deletedAt)
    .map((item) => ({
      ...item,
      householdId,
      updatedAt: Math.max(Number(item.updatedAt) || 0, now),
    }));
}

export function roleLabel(role) {
  if (role === 'reader') return '只能檢視';
  if (role === 'writer' || role === 'owner') return '可編輯';
  return '';
}
