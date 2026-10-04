import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  local: [],
  pending: [],
  remote: [],
  writes: [],
  saves: [],
  deleted: [],
  filesDeleted: [],
}));

vi.mock('./db.js', () => ({
  loadAll: vi.fn(async () => h.local.map((item) => ({ ...item }))),
  listOutbox: vi.fn(async () => h.pending.map((row) => ({ ...row }))),
  saveItem: vi.fn(async (item) => {
    h.saves.push({ ...item });
    return item;
  }),
  deleteItem: vi.fn(async (id, options) => {
    h.deleted.push({ id, ...options });
  }),
  ackOutbox: vi.fn(async (key) => {
    h.pending = h.pending.filter((row) => row.key !== key);
  }),
}));

vi.mock('./drive.js', () => ({
  createPantryFolder: vi.fn(),
  deleteDriveFile: vi.fn(async (fileId) => {
    h.filesDeleted.push(fileId);
  }),
  deletePhotoFile: vi.fn(),
  downloadPhotoFile: vi.fn(async () => new ArrayBuffer(8)),
  driveConfigured: () => true,
  explainDriveError: (error) => error?.message || '同步未完成',
  visibleFolderEditors: vi.fn(),
  googleProfile: vi.fn(async () => ({ email: 'family@example.com', displayName: '家人' })),
  listFolderPermissions: vi.fn(),
  listRemoteItems: vi.fn(async () => h.remote.map((item) => ({ ...item }))),
  readPantryFolder: vi.fn(),
  removeFolderPermission: vi.fn(),
  clearGoogleToken: vi.fn(),
  ensureGoogleAccess: vi.fn(async () => ({})),
  requestGoogleAccess: vi.fn(async () => ({})),
  readLineSubscribersFile: vi.fn(),
  shareFolderWriter: vi.fn(),
  signOutGoogle: vi.fn(),
  uploadPhotoFile: vi.fn(async () => 'photo-file'),
  writeLineSubscribersFile: vi.fn(),
  writeRemoteItem: vi.fn(async (_folderId, item) => {
    h.writes.push({ ...item });
    return item.remoteFileId || 'created-file';
  }),
}));

const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
});

const { signInGoogle, startSession, syncNow } = await import('./session.js');

describe('sync keeps a confirmed delete and edit', () => {
  beforeAll(async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    store.set('pantry-tracker-drive-folders', JSON.stringify([
      { id: 'shared-folder', name: '家裡', role: 'owner' },
    ]));
    store.set('pantry-tracker-drive-active', 'shared-folder');
    startSession({ onStatus: () => {}, onSynced: () => {} });
    await signInGoogle();
  });

  it('writes a tombstone and does not restore the item on the next sync', async () => {
    h.local = [];
    h.pending = [{
      key: 'shared-folder:milk',
      id: 'milk',
      householdId: 'shared-folder',
      op: 'delete',
      updatedAt: 20,
      photoPath: 'drive-photo-1',
    }];
    h.remote = [{
      id: 'milk',
      name: '鮮奶',
      updatedAt: 10,
      remoteFileId: 'drive-file-1',
      photoPath: 'drive-photo-1',
      householdId: 'shared-folder',
    }];
    h.writes = [];
    h.saves = [];
    h.deleted = [];

    await syncNow();

    expect(h.saves).toEqual([]);
    expect(h.writes).toEqual([
      expect.objectContaining({
        id: 'milk',
        deletedAt: 20,
        updatedAt: 20,
        remoteFileId: 'drive-file-1',
      }),
    ]);
    expect(h.deleted).toEqual([expect.objectContaining({ id: 'milk', queue: false })]);
    expect(h.pending).toEqual([]);

    h.remote = [{
      id: 'milk',
      name: '鮮奶',
      updatedAt: 20,
      deletedAt: 20,
      remoteFileId: 'drive-file-1',
      photoPath: null,
      householdId: 'shared-folder',
    }];
    h.writes = [];
    h.saves = [];
    await syncNow();
    expect(h.writes).toEqual([]);
    expect(h.saves).toEqual([]);
  });

  it('uploads a newer edit and a later sync does not restore the old name', async () => {
    const edited = {
      id: 'milk',
      name: '鮮奶（開封）',
      updatedAt: 30,
      remoteFileId: 'file-1',
      householdId: 'shared-folder',
      expiry: null,
      area: '冷藏',
      leadDays: 1,
    };
    h.local = [edited];
    h.pending = [{
      key: 'shared-folder:milk',
      id: 'milk',
      householdId: 'shared-folder',
      op: 'upsert',
      updatedAt: 30,
    }];
    h.remote = [{
      id: 'milk',
      name: '鮮奶',
      updatedAt: 10,
      remoteFileId: 'file-1',
      householdId: 'shared-folder',
    }];
    h.writes = [];
    h.saves = [];

    await syncNow();

    expect(h.writes.map((item) => item.name)).toEqual(['鮮奶（開封）']);
    expect(h.writes[0].deletedAt).toBeNull();
    expect(h.writes[0].updatedAt).toBe(30);
    expect(h.saves.every((item) => item.name === '鮮奶（開封）')).toBe(true);

    h.remote = [{ ...edited }];
    h.pending = [];
    h.writes = [];
    h.saves = [];
    await syncNow();
    expect(h.writes).toEqual([]);
    expect(h.saves).toEqual([]);

    h.local = [{
      id: 'milk',
      name: '鮮奶',
      updatedAt: 10,
      remoteFileId: 'file-1',
      householdId: 'shared-folder',
    }];
    h.remote = [{ ...edited }];
    h.pending = [];
    h.writes = [];
    h.saves = [];
    await syncNow();
    expect(h.writes).toEqual([]);
    expect(h.saves.map((item) => item.name)).toEqual(['鮮奶（開封）']);
  });
});
