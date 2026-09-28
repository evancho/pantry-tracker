import { describe, expect, it } from 'vitest';
import {
  itemsInScope,
  lastWriteWins,
  mergeHouseholdItems,
  migrationCandidates,
  scopeForList,
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
