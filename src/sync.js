const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

export function createInviteCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += INVITE_ALPHABET[Math.floor(random() * INVITE_ALPHABET.length)];
  }
  return code;
}

export function normalizeInviteCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z2-9]{8}$/.test(code) ? code : '';
}

export function inviteLink(origin, base, code) {
  const url = new URL(base || '/', origin);
  url.searchParams.set('join', code);
  return url.href;
}

export function parseJoinCode(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return normalizeInviteCode(params.get('join'));
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
  return role === 'admin' ? '管理員' : '成員';
}
