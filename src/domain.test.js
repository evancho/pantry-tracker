import { describe, expect, it } from 'vitest';
import {
  countdownLabel,
  daysUntilExpiry,
  defaultLeadDays,
  filterAndSort,
  itemStatus,
  leadHint,
  summarize,
  todayISO,
} from './domain.js';

const today = '2026-09-28';

function item(partial) {
  return {
    id: partial.id || partial.name,
    name: partial.name,
    expiry: partial.expiry ?? null,
    area: partial.area || '冷藏',
    leadDays: partial.leadDays,
    createdAt: partial.createdAt || 0,
  };
}

describe('reminder defaults', () => {
  it('uses 7, 3, then 1 day lead times', () => {
    expect(defaultLeadDays(31)).toBe(7);
    expect(defaultLeadDays(30)).toBe(3);
    expect(defaultLeadDays(8)).toBe(3);
    expect(defaultLeadDays(7)).toBe(1);
    expect(defaultLeadDays(1)).toBe(1);
    expect(defaultLeadDays(0)).toBe(1);
    expect(defaultLeadDays(-4)).toBe(1);
  });

  it('formats today in the local calendar', () => {
    expect(todayISO(new Date(2026, 8, 28, 23, 30))).toBe('2026-09-28');
  });

  it('counts whole days until a date-only expiry', () => {
    expect(daysUntilExpiry('2026-10-05', today)).toBe(7);
    expect(daysUntilExpiry('2026-09-28', today)).toBe(0);
    expect(daysUntilExpiry('2026-09-27', today)).toBe(-1);
    expect(daysUntilExpiry('2026-02-31', today)).toBe(null);
  });
});

describe('status', () => {
  it('marks overdue ahead of the remind window', () => {
    expect(itemStatus(item({ name: 'a', expiry: '2026-09-27', leadDays: 7 }), today)).toBe('已過期');
    expect(itemStatus(item({ name: 'a', expiry: '2026-09-28', leadDays: 1 }), today)).toBe('即將到期');
    expect(itemStatus(item({ name: 'a', expiry: '2026-10-08', leadDays: 3 }), today)).toBe('正常');
    expect(itemStatus(item({ name: 'a', expiry: '2026-10-08', leadDays: 10 }), today)).toBe('即將到期');
    expect(itemStatus(item({ name: 'a', expiry: null, leadDays: 1 }), today)).toBe('正常');
  });

  it('describes the countdown', () => {
    expect(countdownLabel(item({ name: 'a', expiry: '2026-10-01' }), today)).toBe('還有 3 天');
    expect(countdownLabel(item({ name: 'a', expiry: '2026-09-28' }), today)).toBe('今天到期');
    expect(countdownLabel(item({ name: 'a', expiry: '2026-09-25' }), today)).toBe('已過期 3 天');
    expect(countdownLabel(item({ name: 'a' }), today)).toBe('未設定期限');
  });

  it('explains automatic lead days', () => {
    expect(leadHint('2026-11-15', 7, today)).toContain('到期前 7 天');
    expect(leadHint('2026-11-15', 2, today)).toContain('已自行調整');
  });
});

describe('filter and sort', () => {
  const items = [
    item({ name: '豆腐', expiry: '2026-10-01', area: '冷藏', leadDays: 3, createdAt: 2 }),
    item({ name: '冷凍水餃', expiry: '2026-12-01', area: '冷凍', leadDays: 7, createdAt: 1 }),
    item({ name: '過期醬', expiry: '2026-09-01', area: '醬料櫃', leadDays: 1, createdAt: 3 }),
    item({ name: '泡麵', expiry: null, area: '泡麵', leadDays: 1, createdAt: 4 }),
  ];

  it('filters by storage area and status together', () => {
    const soon = filterAndSort(items, { area: '冷藏', status: '即將到期', today });
    expect(soon.map((row) => row.name)).toEqual(['豆腐']);
    const expired = filterAndSort(items, { status: '已過期', today });
    expect(expired.map((row) => row.name)).toEqual(['過期醬']);
    expect(summarize(items, today)).toMatchObject({ total: 4, 即將到期: 1, 已過期: 1 });
  });

  it('sorts by expiry, name, and storage area', () => {
    expect(filterAndSort(items, { sort: 'expiry-asc', today }).map((row) => row.name)).toEqual([
      '過期醬',
      '豆腐',
      '冷凍水餃',
      '泡麵',
    ]);
    expect(filterAndSort(items, { sort: 'expiry-desc', today }).map((row) => row.name)).toEqual([
      '冷凍水餃',
      '豆腐',
      '過期醬',
      '泡麵',
    ]);
    expect(filterAndSort(items, { sort: 'name', today }).map((row) => row.name)).toEqual([
      '冷凍水餃',
      '豆腐',
      '泡麵',
      '過期醬',
    ]);
    expect(filterAndSort(items, { sort: 'area', today }).map((row) => row.name)).toEqual([
      '冷凍水餃',
      '豆腐',
      '過期醬',
      '泡麵',
    ]);
  });

  it('filters by ingredient name while sorting the matches', () => {
    expect(filterAndSort(items, { query: '豆', today }).map((row) => row.name)).toEqual(['豆腐']);
    expect(filterAndSort(items, { query: '  泡麵  ', today }).map((row) => row.name)).toEqual(['泡麵']);
    expect(filterAndSort(items, { query: 'MILK', today, sort: 'name' })).toEqual([]);
    const english = [
      item({ name: 'Milk', expiry: '2026-10-02', createdAt: 1 }),
      item({ name: '牛奶', expiry: '2026-10-01', createdAt: 2 }),
    ];
    expect(filterAndSort(english, { query: 'milk', sort: 'expiry-asc', today }).map((row) => row.name)).toEqual(['Milk']);
    expect(filterAndSort(items, { query: '   ', sort: 'name', today }).map((row) => row.name)).toEqual([
      '冷凍水餃',
      '豆腐',
      '泡麵',
      '過期醬',
    ]);
  });
});
