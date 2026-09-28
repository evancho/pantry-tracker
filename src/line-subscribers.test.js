import { describe, expect, it } from 'vitest';
import { countdownLabel } from './domain.js';
import {
  addLineSubscriber,
  composeLineMessage,
  emptyLineSubscribers,
  normalizeLineUserId,
  parseDriveFolderIds,
  parseLineSubscribers,
  removeLineSubscriber,
  serializeLineSubscribers,
  setLineEnabled,
  taipeiTodayISO,
  workerReadiness,
} from './line-subscribers.js';

const USER = `U${'ab'.repeat(16)}`;

describe('line subscribers', () => {
  it('rejects garbage user ids and keeps a valid one', () => {
    expect(normalizeLineUserId('  not-a-user  ')).toBe('');
    expect(normalizeLineUserId('U123')).toBe('');
    expect(normalizeLineUserId(USER)).toBe(USER);
    const parsed = parseLineSubscribers({
      enabled: false,
      subscribers: [
        { userId: 'hello', label: '壞的' },
        { userId: USER, label: '  媽媽  ', addedAt: '2026-09-28T00:00:00.000Z' },
        { userId: USER, label: '重複' },
      ],
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.subscribers).toEqual([
      { userId: USER, label: '媽媽', addedAt: '2026-09-28T00:00:00.000Z' },
    ]);
  });

  it('returns an empty list when the file is missing or broken', () => {
    expect(parseLineSubscribers('')).toEqual(emptyLineSubscribers());
    expect(parseLineSubscribers('{')).toEqual(emptyLineSubscribers());
    expect(parseLineSubscribers(null).enabled).toBe(true);
  });

  it('adds, skips duplicates, and removes', () => {
    const added = addLineSubscriber(emptyLineSubscribers(), { userId: USER, label: '爸爸', addedAt: '2026-09-28T01:00:00.000Z' });
    expect(added.ok).toBe(true);
    expect(addLineSubscriber(added.doc, { userId: 'nope' }).reason).toBe('invalid');
    expect(addLineSubscriber(added.doc, { userId: USER }).reason).toBe('duplicate');
    const off = setLineEnabled(added.doc, false);
    expect(off.enabled).toBe(false);
    const removed = removeLineSubscriber(off, USER);
    expect(removed.subscribers).toEqual([]);
    expect(removed.enabled).toBe(false);
    const roundTrip = parseLineSubscribers(serializeLineSubscribers(added.doc));
    expect(roundTrip.subscribers[0].label).toBe('爸爸');
  });

  it('composes a reminder from the same expiry window as the app', () => {
    const today = '2026-09-28';
    const text = composeLineMessage([
      { name: '牛奶', expiry: '2026-09-28', leadDays: 1 },
      { name: '米', expiry: '2026-12-01', leadDays: 1 },
      { name: '已刪', expiry: '2026-09-28', leadDays: 1, deletedAt: 1 },
    ], today);
    expect(text).toBe(`生活提醒\n牛奶 · ${countdownLabel({ name: '牛奶', expiry: '2026-09-28' }, today)}`);
    expect(composeLineMessage([{ name: '米', expiry: '2026-12-01', leadDays: 1 }], today)).toBe('');
  });

  it('reports missing worker secrets without throwing', () => {
    expect(workerReadiness({}).ready).toBe(false);
    expect(workerReadiness({}).missing).toEqual([
      'LINE_CHANNEL_ACCESS_TOKEN',
      'GOOGLE_SERVICE_ACCOUNT_JSON',
      'DRIVE_FOLDER_IDS',
    ]);
    expect(workerReadiness({
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
      DRIVE_FOLDER_IDS: 'bad, folder_id_ok',
    }).folders).toEqual(['folder_id_ok']);
    expect(parseDriveFolderIds("id' OR 1=1, short")).toEqual([]);
    expect(taipeiTodayISO(new Date('2026-09-27T16:30:00.000Z'))).toBe('2026-09-28');
  });
});
