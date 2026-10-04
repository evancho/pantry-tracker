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

function versionStamp(item) {
  return Math.max(Number(item?.updatedAt) || 0, Number(item?.deletedAt) || 0);
}

export function collapseRemoteItems(remoteItems) {
  const groups = new Map();
  for (const item of remoteItems || []) {
    if (!item?.id) continue;
    const rows = groups.get(item.id);
    if (rows) rows.push(item);
    else groups.set(item.id, [item]);
  }
  const items = [];
  const staleFileIds = [];
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) => {
      const byStamp = versionStamp(b) - versionStamp(a);
      if (byStamp) return byStamp;
      return (Number(b?.deletedAt) || 0) - (Number(a?.deletedAt) || 0);
    });
    const winner = ranked[0];
    items.push(winner);
    for (const loser of ranked.slice(1)) {
      if (loser.remoteFileId && loser.remoteFileId !== winner.remoteFileId) staleFileIds.push(loser.remoteFileId);
    }
  }
  return { items, staleFileIds };
}

export function nextStoredDriveFields(item, existing) {
  return {
    remoteFileId: item && item.remoteFileId !== undefined ? (item.remoteFileId || null) : (existing?.remoteFileId || null),
    photoPath: item && item.photoPath !== undefined ? (item.photoPath || null) : (existing?.photoPath || null),
  };
}

export function prepareStoredItem(existing, incoming, { queue = true } = {}) {
  if (!incoming) return { action: 'keep', item: existing || null };
  const existingAt = Number(existing?.updatedAt) || 0;
  const incomingAt = Number(incoming.updatedAt) || 0;
  if (existing && !queue && existingAt > incomingAt) return { action: 'keep', item: existing };
  if (existing && !queue && existingAt === incomingAt) {
    const remoteFileId = incoming.remoteFileId || existing.remoteFileId || null;
    const photoPath = incoming.photoPath !== undefined ? (incoming.photoPath || null) : (existing.photoPath || null);
    if (remoteFileId === (existing.remoteFileId || null) && photoPath === (existing.photoPath || null)) {
      return { action: 'keep', item: existing };
    }
    return { action: 'patch', item: { ...existing, remoteFileId, photoPath } };
  }
  const fields = nextStoredDriveFields(incoming, existing);
  return {
    action: 'write',
    item: { ...incoming, remoteFileId: fields.remoteFileId, photoPath: fields.photoPath },
  };
}

export function reconcileHousehold({ localItems = [], remoteItems = [], pending = [] } = {}) {
  const collapsed = collapseRemoteItems(remoteItems);
  const remoteList = collapsed.items;
  const remoteById = new Map(remoteList.map((item) => [item.id, item]));
  const opById = new Map();
  for (const row of pending || []) {
    if (!row?.id || (row.op !== 'delete' && row.op !== 'upsert')) continue;
    opById.set(row.id, row);
  }
  const localById = new Map();
  for (const item of localItems || []) {
    if (item?.id && !item.deletedAt) localById.set(item.id, item);
  }

  const ackDeletes = [];
  const seenDeleteAcks = new Set();
  function queueAckDelete(row) {
    if (!row?.id || seenDeleteAcks.has(row.id)) return;
    seenDeleteAcks.add(row.id);
    ackDeletes.push({ id: row.id, updatedAt: Number(row.updatedAt) || 0 });
  }

  const suppressed = new Set();
  for (const row of opById.values()) {
    if (row.op !== 'delete') continue;
    const local = localById.get(row.id);
    if (local && Number(local.updatedAt) > Number(row.updatedAt)) {
      queueAckDelete(row);
      continue;
    }
    suppressed.add(row.id);
  }

  const visibleLocal = [...localById.values()].filter((item) => !suppressed.has(item.id));
  const localTombstones = [...opById.values()]
    .filter((row) => row.op === 'delete' && suppressed.has(row.id))
    .map((row) => ({
      id: row.id,
      name: '',
      updatedAt: Number(row.updatedAt) || 0,
      deletedAt: Number(row.updatedAt) || 0,
      photoPath: row.photoPath || null,
    }));

  const merged = mergeHouseholdItems([...visibleLocal, ...localTombstones], remoteList);
  const pull = [];
  const push = [];
  const ackUpserts = [];

  for (const item of merged.items) {
    if (item.deletedAt) continue;
    const op = opById.get(item.id);
    const local = visibleLocal.find((row) => row.id === item.id) || null;
    const remoteItem = remoteById.get(item.id) || null;
    const itemAt = Number(item.updatedAt) || 0;
    const remoteAt = Number(remoteItem?.updatedAt) || 0;
    const localAt = Number(local?.updatedAt) || 0;
    const pendingUpsertAt = op?.op === 'upsert' ? (Number(op.updatedAt) || 0) : 0;
    if (pendingUpsertAt > localAt && pendingUpsertAt > remoteAt) continue;

    const deleteAt = op?.op === 'delete' ? (Number(op.updatedAt) || 0) : 0;
    const deleteWins = op?.op === 'delete' && deleteAt >= itemAt;
    if ((!local || itemAt > localAt) && !deleteWins) {
      pull.push({
        ...item,
        remoteFileId: item.remoteFileId || remoteItem?.remoteFileId || null,
      });
    }
    if (local && itemAt > remoteAt && itemAt >= pendingUpsertAt && !deleteWins) {
      push.push({
        ...local,
        remoteFileId: local.remoteFileId || remoteItem?.remoteFileId || null,
      });
      continue;
    }
    if (deleteWins) continue;
    if (op?.op === 'delete') queueAckDelete(op);
    else if (op?.op === 'upsert') ackUpserts.push({ id: item.id, updatedAt: itemAt });
  }

  const tombstones = [];
  for (const row of opById.values()) {
    if (row.op !== 'delete' || seenDeleteAcks.has(row.id)) continue;
    const remoteItem = remoteById.get(row.id);
    const deletedAt = Number(row.updatedAt) || 0;
    if (!remoteItem || (remoteItem.deletedAt && Number(remoteItem.deletedAt) >= deletedAt)) {
      queueAckDelete(row);
      continue;
    }
    if (!remoteItem.deletedAt && (Number(remoteItem.updatedAt) || 0) > deletedAt) {
      queueAckDelete(row);
      continue;
    }
    tombstones.push({
      id: row.id,
      updatedAt: deletedAt,
      deletedAt,
      photoPath: row.photoPath || remoteItem.photoPath || null,
      remoteFileId: remoteItem.remoteFileId || null,
      name: remoteItem.name || '',
      expiry: remoteItem.expiry ?? null,
      area: remoteItem.area || '冷藏',
      leadDays: remoteItem.leadDays ?? 1,
      createdAt: remoteItem.createdAt || deletedAt,
      householdId: row.householdId || remoteItem.householdId || null,
    });
  }

  for (const row of opById.values()) {
    if (row.op !== 'upsert') continue;
    const local = localById.get(row.id);
    const remoteItem = remoteById.get(row.id);
    const pendingAt = Number(row.updatedAt) || 0;
    const localAt = Number(local?.updatedAt) || 0;
    if (remoteItem?.deletedAt && Number(remoteItem.deletedAt) >= pendingAt && Number(remoteItem.deletedAt) >= localAt) {
      ackUpserts.push({ id: row.id, updatedAt: pendingAt });
    }
  }

  const tombstoneIds = new Set(tombstones.map((row) => row.id));
  const pushIds = new Set(push.map((item) => item.id));
  const seenUpsertAcks = new Set();
  const uniqueUpserts = [];
  for (const row of ackUpserts) {
    if (pushIds.has(row.id) || tombstoneIds.has(row.id) || seenUpsertAcks.has(row.id)) continue;
    seenUpsertAcks.add(row.id);
    uniqueUpserts.push(row);
  }

  return {
    dropIds: merged.dropIds,
    pull: pull.filter((item) => !tombstoneIds.has(item.id)),
    push: push.filter((item) => !tombstoneIds.has(item.id)),
    tombstones,
    ackUpserts: uniqueUpserts,
    ackDeletes,
    staleFileIds: collapsed.staleFileIds,
  };
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
  needsReauth = false,
} = {}) {
  if (!online) return { key: 'offline', label: '離線' };
  if (syncing) return { key: 'syncing', label: '同步中' };
  if (!configured) return { key: 'local', label: '只在這台裝置' };
  if (!user || needsReauth) return { key: 'login', label: '需登入才能同步' };
  if (!activeHouseholdId) return { key: 'folder', label: '尚未設定資料夾' };
  const text = String(message || '');
  if (role === 'reader' || /只能檢視/.test(text)) return { key: 'reader', label: '只能檢視' };
  if (/已與 Google 雲端硬碟同步|已從 Google 雲端硬碟更新/.test(text)) return { key: 'synced', label: '已同步' };
  if (text) return { key: 'error', label: '同步未完成' };
  return { key: 'pending', label: '尚未同步' };
}

export function syncDetailMessage(message) {
  const text = String(message || '').trim();
  if (!text || text === '已與 Google 雲端硬碟同步' || text.startsWith('已記住')) return '';
  return text;
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
