import { countdownLabel, isInRemindWindow } from './domain.js';
import { LINE_BOT_NAME } from './line-config.js';

const USER_ID = /^U[0-9a-fA-F]{32}$/;

export function emptyLineSubscribers() {
  return { version: 1, enabled: true, subscribers: [] };
}

export function normalizeLineUserId(value) {
  const id = String(value || '').trim();
  return USER_ID.test(id) ? id : '';
}

export function parseLineSubscribers(raw) {
  const empty = emptyLineSubscribers();
  let data = raw;
  if (raw == null || raw === '') return empty;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return empty;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  const seen = new Set();
  const subscribers = [];
  for (const row of Array.isArray(data.subscribers) ? data.subscribers : []) {
    const userId = normalizeLineUserId(row?.userId);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    subscribers.push({
      userId,
      label: String(row?.label || '').trim().slice(0, 20),
      addedAt: typeof row?.addedAt === 'string' ? row.addedAt : '',
    });
  }
  return {
    version: 1,
    enabled: data.enabled !== false,
    subscribers,
  };
}

export function serializeLineSubscribers(doc) {
  const parsed = parseLineSubscribers(doc);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function addLineSubscriber(doc, { userId, label = '', addedAt = '' } = {}) {
  const base = parseLineSubscribers(doc);
  const id = normalizeLineUserId(userId);
  if (!id) return { ok: false, reason: 'invalid', doc: base };
  if (base.subscribers.some((row) => row.userId === id)) {
    return { ok: false, reason: 'duplicate', doc: base };
  }
  return {
    ok: true,
    doc: {
      ...base,
      subscribers: [
        ...base.subscribers,
        {
          userId: id,
          label: String(label || '').trim().slice(0, 20),
          addedAt: addedAt || new Date().toISOString(),
        },
      ],
    },
  };
}

export function removeLineSubscriber(doc, userId) {
  const base = parseLineSubscribers(doc);
  const id = normalizeLineUserId(userId);
  return {
    ...base,
    subscribers: base.subscribers.filter((row) => row.userId !== id),
  };
}

export function setLineEnabled(doc, enabled) {
  const base = parseLineSubscribers(doc);
  return { ...base, enabled: Boolean(enabled) };
}

export function dueReminderItems(items, today) {
  return (Array.isArray(items) ? items : []).filter((item) => item && !item.deletedAt && isInRemindWindow(item, today));
}

export function composeLineMessage(items, today, { botName = LINE_BOT_NAME, limit = 12 } = {}) {
  const due = dueReminderItems(items, today);
  if (!due.length) return '';
  const lines = due.slice(0, limit).map((item) => {
    const name = String(item.name || '').trim() || '未命名';
    return `${name} · ${countdownLabel(item, today)}`;
  });
  if (due.length > lines.length) lines.push(`還有 ${due.length - lines.length} 項`);
  return [`${botName}`, ...lines].join('\n');
}

export function taipeiTodayISO(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function parseDriveFolderIds(value) {
  return [...new Set(String(value || '').split(',').map((part) => part.trim()).filter((id) => /^[a-zA-Z0-9_-]{10,128}$/.test(id)))];
}

/** Cron needs a token, a service account, and at least one folder id. Missing values skip the run. */
export function workerReadiness(env = {}) {
  const missing = [];
  if (!String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim()) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  const folders = parseDriveFolderIds(env.DRIVE_FOLDER_IDS);
  if (!folders.length) missing.push('DRIVE_FOLDER_IDS');
  return {
    ready: missing.length === 0,
    missing,
    folders,
    lineSecretSet: Boolean(String(env.LINE_CHANNEL_SECRET || '').trim()),
    kvBound: Boolean(env.LINE_REMIND_KV),
  };
}
