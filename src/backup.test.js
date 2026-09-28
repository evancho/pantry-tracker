import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup } from './backup.js';

describe('backup', () => {
  it('round-trips items and keeps a photo data url', () => {
    const payload = buildBackup([
      {
        id: 'a1',
        name: '鮮奶',
        expiry: '2026-12-31',
        area: '冷藏',
        leadDays: 7,
        createdAt: 10,
        updatedAt: 20,
        photo: 'data:image/jpeg;base64,abc',
      },
    ], '2026-09-28T00:00:00.000Z');
    const parsed = parseBackup(JSON.stringify(payload));
    expect(parsed.items).toEqual([
      {
        id: 'a1',
        name: '鮮奶',
        expiry: '2026-12-31',
        area: '冷藏',
        leadDays: 7,
        createdAt: 10,
        updatedAt: 20,
        photo: 'data:image/jpeg;base64,abc',
      },
    ]);
    expect(parsed.skipped).toBe(0);
  });

  it('rejects other files and skips invalid rows', () => {
    expect(() => parseBackup('{"app":"other","items":[]}')).toThrow(/不是食材櫃/);
    expect(() => parseBackup('{')).toThrow(/無法讀取/);
    const parsed = parseBackup(JSON.stringify({
      app: 'pantry-tracker',
      version: 1,
      items: [
        { name: '豆腐', area: '冷藏', expiry: '2026-10-01', leadDays: 99 },
        { name: '壞掉', area: '客廳', expiry: '2026-10-01' },
        { name: '日期壞了', area: '冷凍', expiry: '2026-02-31' },
      ],
    }));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].name).toBe('豆腐');
    expect(parsed.items[0].leadDays).toBe(99);
    expect(parsed.skipped).toBe(2);
  });
});
