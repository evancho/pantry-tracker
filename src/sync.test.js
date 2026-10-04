import { describe, expect, it } from 'vitest';
import {
  itemsInScope,
  lastWriteWins,
  mergeHouseholdItems,
  migrationCandidates,
  prepareStoredItem,
  reconcileHousehold,
  scopeForList,
  syncStatusLabel,
} from './sync.js';

describe('last-write-wins merge', () => {
  it('keeps the newer copy and drops a newer tombstone', () => {
    const local = [
      { id: 'a', name: '本地', updatedAt: 20, photoPath: 'old', photoBlob: 'blob' },
      { id: 'b', name: '只在本地', updatedAt: 5 },
      { id: 'c', name: '要刪', updatedAt: 10 },
    ];
    const remote = [
      { id: 'a', name: '雲端', updatedAt: 30, photoPath: 'new' },
      { id: 'c', name: '要刪', updatedAt: 12, deletedAt: 12 },
      { id: 'd', name: '只在雲端', updatedAt: 8, photoPath: 'pic' },
    ];
    const plan = mergeHouseholdItems(local, remote);
    expect(plan.dropIds).toEqual(['c']);
    expect(plan.pushIds).toEqual(['b']);
    const byId = Object.fromEntries(plan.items.map((item) => [item.id, item]));
    expect(byId.a.name).toBe('雲端');
    expect(byId.a.photoMissing).toBe(true);
    expect(byId.b.name).toBe('只在本地');
    expect(byId.d.photoMissing).toBe(true);
    expect(byId.c).toBeUndefined();
  });

  it('keeps a newer local edit over an older remote delete', () => {
    const plan = mergeHouseholdItems(
      [{ id: 'a', name: '還在', updatedAt: 50 }],
      [{ id: 'a', name: '還在', updatedAt: 40, deletedAt: 40 }],
    );
    expect(plan.dropIds).toEqual([]);
    expect(plan.items.map((item) => item.name)).toEqual(['還在']);
    expect(plan.pushIds).toEqual(['a']);
  });

  it('does not push when both copies have the same time', () => {
    const plan = mergeHouseholdItems(
      [{ id: 'a', name: '鮮奶', updatedAt: 10, photoPath: 'p', photoBlob: 'blob' }],
      [{ id: 'a', name: '鮮奶', updatedAt: 10, photoPath: 'p' }],
    );
    expect(plan.pushIds).toEqual([]);
    expect(plan.items[0].photoBlob).toBe('blob');
    expect(lastWriteWins({ updatedAt: 10 }, { updatedAt: 10 })).toBe('tie');
  });
});

describe('list without a Google session', () => {
  it('shows household rows saved on this device when there is no user', () => {
    const items = [
      { id: 'milk', name: '鮮奶', householdId: 'folder-1', createdAt: 2 },
      { id: 'tofu', name: '豆腐', householdId: null, createdAt: 1 },
      { id: 'gone', name: '已刪', householdId: 'folder-1', deletedAt: 9, createdAt: 3 },
    ];
    const scope = scopeForList({ user: null, activeHouseholdId: 'folder-1' });
    expect(scope).toBe('folder-1');
    expect(itemsInScope(items, scope).map((item) => item.name)).toEqual(['鮮奶']);
  });

  it('keeps unbound device rows when no folder was chosen', () => {
    const items = [
      { id: 'milk', name: '鮮奶', householdId: 'folder-1' },
      { id: 'tofu', name: '豆腐' },
    ];
    expect(itemsInScope(items, scopeForList({ user: null, activeHouseholdId: null })).map((item) => item.name)).toEqual(['豆腐']);
    const moved = migrationCandidates(items, 'folder-1', 30);
    expect(moved.map((item) => item.id)).toEqual(['tofu']);
  });
});

describe('homepage sync status', () => {
  const signedIn = {
    configured: true,
    user: { email: 'family@example.com' },
    activeHouseholdId: 'folder-1',
    online: true,
  };

  it('uses a short label for offline, syncing, login, folder, and synced', () => {
    expect(syncStatusLabel({ ...signedIn, online: false }).label).toBe('離線');
    expect(syncStatusLabel({ ...signedIn, online: false, syncing: true }).label).toBe('離線');
    expect(syncStatusLabel({ ...signedIn, syncing: true }).label).toBe('同步中');
    expect(syncStatusLabel({ ...signedIn, user: null }).label).toBe('需登入才能同步');
    expect(syncStatusLabel({ ...signedIn, needsReauth: true }).label).toBe('需登入才能同步');
    expect(syncStatusLabel({
      configured: true,
      user: { email: 'family@example.com' },
      activeHouseholdId: null,
      online: true,
    }).label).toBe('尚未設定資料夾');
    expect(syncStatusLabel({ ...signedIn, message: '已與 Google 雲端硬碟同步' }).label).toBe('已同步');
    expect(syncStatusLabel({ configured: false, online: true }).label).toBe('只在這台裝置');
    expect(syncStatusLabel({ ...signedIn, message: '沒有這個資料夾的編輯權限' }).label).toBe('同步未完成');
    expect(syncStatusLabel({ ...signedIn, role: 'reader', message: '已從 Google 雲端硬碟更新' }).label).toBe('只能檢視');
  });
});

describe('delete then sync', () => {
  const householdId = 'shared-folder';

  it('does not resurrect a deleted item on the next sync or another device', () => {
    const remote = {
      id: 'milk',
      name: '鮮奶',
      updatedAt: 10,
      remoteFileId: 'drive-file-1',
      photoPath: 'drive-photo-1',
      householdId,
    };
    const deleting = reconcileHousehold({
      localItems: [],
      remoteItems: [remote],
      pending: [{
        id: 'milk',
        op: 'delete',
        updatedAt: 20,
        photoPath: 'drive-photo-1',
        householdId,
        key: `${householdId}:milk`,
      }],
    });
    expect(deleting.pull).toEqual([]);
    expect(deleting.push).toEqual([]);
    expect(deleting.ackUpserts).toEqual([]);
    expect(deleting.ackDeletes).toEqual([]);
    expect(deleting.tombstones).toEqual([
      expect.objectContaining({
        id: 'milk',
        remoteFileId: 'drive-file-1',
        updatedAt: 20,
        deletedAt: 20,
        photoPath: 'drive-photo-1',
        householdId,
      }),
    ]);

    const remoteAfter = [{
      ...remote,
      updatedAt: 20,
      deletedAt: 20,
      photoPath: null,
    }];
    const reload = reconcileHousehold({
      localItems: [],
      remoteItems: remoteAfter,
      pending: [],
    });
    expect(reload.pull).toEqual([]);
    expect(reload.push).toEqual([]);
    expect(reload.tombstones).toEqual([]);

    const otherDevice = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, householdId }],
      remoteItems: remoteAfter,
      pending: [],
    });
    expect(otherDevice.dropIds).toEqual(['milk']);
    expect(otherDevice.pull).toEqual([]);
    expect(otherDevice.push).toEqual([]);
  });

  it('keeps a newer remote edit instead of applying an older delete', () => {
    const plan = reconcileHousehold({
      localItems: [],
      remoteItems: [{ id: 'milk', name: '鮮奶改名', updatedAt: 50, remoteFileId: 'file-1', householdId: 'shared-folder' }],
      pending: [{ id: 'milk', op: 'delete', updatedAt: 20, householdId: 'shared-folder' }],
    });
    expect(plan.pull.map((item) => item.name)).toEqual(['鮮奶改名']);
    expect(plan.tombstones).toEqual([]);
    expect(plan.ackDeletes).toEqual([{ id: 'milk', updatedAt: 20 }]);
  });
});

describe('edit then sync', () => {
  const householdId = 'shared-folder';

  it('does not overwrite a confirmed edit with the older cloud copy', () => {
    const edited = {
      id: 'milk',
      name: '鮮奶（開封）',
      updatedAt: 30,
      remoteFileId: 'file-1',
      householdId,
    };
    const remote = {
      id: 'milk',
      name: '鮮奶',
      updatedAt: 10,
      remoteFileId: 'file-1',
      householdId,
    };
    const first = reconcileHousehold({
      localItems: [edited],
      remoteItems: [remote],
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 30, householdId, key: `${householdId}:milk` }],
    });
    expect(first.pull).toEqual([]);
    expect(first.tombstones).toEqual([]);
    expect(first.ackUpserts).toEqual([]);
    expect(first.ackDeletes).toEqual([]);
    expect(first.push.map((item) => item.name)).toEqual(['鮮奶（開封）']);
    expect(first.push[0].updatedAt).toBe(30);
    expect(first.push[0].remoteFileId).toBe('file-1');

    const remoteAfter = [{ ...edited, name: '鮮奶（開封）' }];
    const reload = reconcileHousehold({
      localItems: [edited],
      remoteItems: remoteAfter,
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 30, householdId }],
    });
    expect(reload.pull).toEqual([]);
    expect(reload.push).toEqual([]);
    expect(reload.ackUpserts).toEqual([{ id: 'milk', updatedAt: 30 }]);

    const otherDevice = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'file-1', householdId }],
      remoteItems: remoteAfter,
      pending: [],
    });
    expect(otherDevice.pull.map((item) => item.name)).toEqual(['鮮奶（開封）']);
    expect(otherDevice.push).toEqual([]);
  });

  it('uploads a newer local edit over an older remote delete', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'milk', name: '還在', updatedAt: 50, householdId: 'shared-folder' }],
      remoteItems: [{ id: 'milk', name: '還在', updatedAt: 40, deletedAt: 40, remoteFileId: 'file-1' }],
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 50, householdId: 'shared-folder' }],
    });
    expect(plan.dropIds).toEqual([]);
    expect(plan.pull).toEqual([]);
    expect(plan.push.map((item) => item.name)).toEqual(['還在']);
    expect(plan.ackUpserts).toEqual([]);
  });

  it('still accepts a newer cloud edit', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, householdId: 'shared-folder' }],
      remoteItems: [{ id: 'milk', name: '鮮奶（開封）', updatedAt: 40, remoteFileId: 'file-1', householdId: 'shared-folder' }],
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 10, householdId: 'shared-folder' }],
    });
    expect(plan.pull.map((item) => item.name)).toEqual(['鮮奶（開封）']);
    expect(plan.push).toEqual([]);
    expect(plan.ackUpserts).toEqual([{ id: 'milk', updatedAt: 40 }]);
  });

  it('does not upload a stale row over a newer confirmed edit', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'file-1' }],
      remoteItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'file-1' }],
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 40, householdId: 'shared-folder' }],
    });
    expect(plan.pull).toEqual([]);
    expect(plan.push).toEqual([]);
    expect(plan.ackUpserts).toEqual([]);
  });

  it('uploads an edit and tombstones a delete in the same sync', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'tofu', name: '豆腐', updatedAt: 12, householdId: 'shared-folder' }],
      remoteItems: [
        { id: 'tofu', name: '豆腐', updatedAt: 10, remoteFileId: 'tofu-file', householdId: 'shared-folder' },
        { id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'milk-file', householdId: 'shared-folder' },
      ],
      pending: [{ id: 'milk', op: 'delete', updatedAt: 12, householdId: 'shared-folder' }],
    });
    expect(plan.push.map((item) => item.id)).toEqual(['tofu']);
    expect(plan.tombstones.map((item) => item.id)).toEqual(['milk']);
    expect(plan.pull).toEqual([]);
    expect(plan.ackUpserts.map((item) => item.id)).not.toContain('milk');
    expect(plan.ackDeletes.map((item) => item.id)).not.toContain('milk');
  });

  it('uses the newest Drive file when the same item was written twice', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'old-file' }],
      remoteItems: [
        { id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'old-file' },
        { id: 'milk', name: '鮮奶（開封）', updatedAt: 30, remoteFileId: 'new-file' },
      ],
      pending: [],
    });
    expect(plan.staleFileIds).toEqual(['old-file']);
    expect(plan.pull.map((item) => item.name)).toEqual(['鮮奶（開封）']);
    expect(plan.push).toEqual([]);
  });

  it('does not treat an older duplicate as the cloud copy of a confirmed edit', () => {
    const plan = reconcileHousehold({
      localItems: [{ id: 'milk', name: '鮮奶（開封）', updatedAt: 30, remoteFileId: 'new-file' }],
      remoteItems: [
        { id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'old-file' },
        { id: 'milk', name: '鮮奶（開封）', updatedAt: 30, remoteFileId: 'new-file' },
      ],
      pending: [{ id: 'milk', op: 'upsert', updatedAt: 30, householdId: 'shared-folder' }],
    });
    expect(plan.pull).toEqual([]);
    expect(plan.push).toEqual([]);
    expect(plan.ackUpserts).toEqual([{ id: 'milk', updatedAt: 30 }]);
    expect(plan.staleFileIds).toEqual(['old-file']);
  });
});

describe('local write versus an older cloud snapshot', () => {
  it('keeps the Drive file id when the edit omits it', () => {
    const prepared = prepareStoredItem(
      { id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'file-1', photoPath: 'photo-1', householdId: 'shared-folder' },
      { id: 'milk', name: '鮮奶（開封）', updatedAt: 30, householdId: 'shared-folder' },
      { queue: true },
    );
    expect(prepared.action).toBe('write');
    expect(prepared.item.name).toBe('鮮奶（開封）');
    expect(prepared.item.remoteFileId).toBe('file-1');
    expect(prepared.item.photoPath).toBe('photo-1');
  });

  it('does not replace a newer local edit with an older cloud snapshot', () => {
    const prepared = prepareStoredItem(
      { id: 'milk', name: '鮮奶（開封）', updatedAt: 30, remoteFileId: 'file-1', householdId: 'shared-folder' },
      { id: 'milk', name: '鮮奶', updatedAt: 10, remoteFileId: 'file-1', householdId: 'shared-folder' },
      { queue: false },
    );
    expect(prepared.action).toBe('keep');
    expect(prepared.item.name).toBe('鮮奶（開封）');
    expect(prepared.item.updatedAt).toBe(30);
  });

  it('stores a Drive file id without rolling back the edited name', () => {
    const prepared = prepareStoredItem(
      { id: 'milk', name: '鮮奶（開封）', updatedAt: 30, remoteFileId: null, photoPath: null },
      { id: 'milk', name: '鮮奶', updatedAt: 30, remoteFileId: 'file-1', photoPath: 'photo-1' },
      { queue: false },
    );
    expect(prepared.action).toBe('patch');
    expect(prepared.item.name).toBe('鮮奶（開封）');
    expect(prepared.item.remoteFileId).toBe('file-1');
    expect(prepared.item.photoPath).toBe('photo-1');
  });

  it('still applies a newer cloud item', () => {
    const prepared = prepareStoredItem(
      { id: 'milk', name: '鮮奶', updatedAt: 10 },
      { id: 'milk', name: '鮮奶（開封）', updatedAt: 40, remoteFileId: 'file-1' },
      { queue: false },
    );
    expect(prepared.action).toBe('write');
    expect(prepared.item.name).toBe('鮮奶（開封）');
  });
});

describe('migration', () => {
  it('moves only this-device items into the household', () => {
    const moved = migrationCandidates([
      { id: 'local', name: '豆腐', updatedAt: 3 },
      { id: 'cloud', name: '奶茶', householdId: 'h1', updatedAt: 9 },
    ], 'home', 20);
    expect(moved).toEqual([
      { id: 'local', name: '豆腐', updatedAt: 20, householdId: 'home' },
    ]);
  });
});
