import { countdownLabel, isInRemindWindow, todayISO } from './domain.js';

const LOG_KEY = 'pantry-tracker-notified';

export function notificationSupport() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function readLog() {
  try {
    const data = JSON.parse(localStorage.getItem(LOG_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeLog(log) {
  localStorage.setItem(LOG_KEY, JSON.stringify(log));
}

function pruneLog(log, today) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  for (const [id, day] of Object.entries(log)) {
    if (typeof day !== 'string' || day < cutoffIso) delete log[id];
  }
}

function messageFor(items, today) {
  if (items.length === 1) {
    const item = items[0];
    return `${item.name} ${countdownLabel(item, today)}`;
  }
  const names = items.slice(0, 3).map((item) => item.name).join('、');
  const more = items.length > 3 ? '…' : '';
  return `${items.length} 項食材需要留意：${names}${more}`;
}

export async function updateAppBadge(count) {
  try {
    if (!navigator.setAppBadge) return;
    if (count > 0) await navigator.setAppBadge(count);
    else if (navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch {
    // Badging is optional. Card badges still show the status.
  }
}

export async function checkReminders(items, today = todayISO(), { icon } = {}) {
  const due = items.filter((item) => isInRemindWindow(item, today));
  await updateAppBadge(due.length);
  if (notificationSupport() !== 'granted' || due.length === 0) return;

  const log = readLog();
  pruneLog(log, today);
  const fresh = due.filter((item) => log[item.id] !== today);
  if (fresh.length === 0) {
    writeLog(log);
    return;
  }
  for (const item of fresh) log[item.id] = today;
  writeLog(log);

  const title = '食材櫃';
  const body = messageFor(fresh, today);
  const options = {
    body,
    lang: 'zh-TW',
    tag: 'pantry-reminders',
    icon,
  };
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.showNotification(title, options);
    } catch {
      // Permission can be granted but the platform still refuses to show one.
    }
  }
}
