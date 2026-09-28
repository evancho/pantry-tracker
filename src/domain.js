export const AREAS = Object.freeze([
  '冷凍',
  '冷藏',
  '醬料櫃',
  '上方調味粉櫃',
  '泡麵',
  '罐頭區',
]);

export const STATUS_FILTERS = Object.freeze(['全部', '即將到期', '已過期', '正常']);

export const SORTS = Object.freeze([
  { id: 'expiry-asc', label: '到期日（近到遠）' },
  { id: 'expiry-desc', label: '到期日（遠到近）' },
  { id: 'name', label: '名稱' },
  { id: 'area', label: '存放位置' },
]);

const DAY_MS = 86400000;

export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [y, m, d] = value.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== y
    || check.getUTCMonth() !== m - 1
    || check.getUTCDate() !== d
  ) {
    return null;
  }
  return utc;
}

export function daysUntilExpiry(expiry, today) {
  const end = parseISODate(expiry);
  const start = parseISODate(today);
  if (end == null || start == null) return null;
  return Math.round((end - start) / DAY_MS);
}

/** Default remind-before days from the product rules. */
export function defaultLeadDays(daysUntil) {
  if (daysUntil == null || Number.isNaN(daysUntil)) return 1;
  if (daysUntil > 30) return 7;
  if (daysUntil > 7) return 3;
  return 1;
}

export function normalizeLeadDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(365, Math.max(0, Math.round(n)));
}

export function resolveLeadDays(item, daysUntil) {
  if (item && item.leadDays != null && item.leadDays !== '') {
    return normalizeLeadDays(item.leadDays);
  }
  return defaultLeadDays(daysUntil);
}

export function isValidArea(area) {
  return AREAS.includes(area);
}

export function itemStatus(item, today) {
  const days = daysUntilExpiry(item?.expiry, today);
  if (days == null) return '正常';
  if (days < 0) return '已過期';
  if (days <= resolveLeadDays(item, days)) return '即將到期';
  return '正常';
}

export function isInRemindWindow(item, today) {
  const days = daysUntilExpiry(item?.expiry, today);
  if (days == null) return false;
  return days <= resolveLeadDays(item, days);
}

export function countdownLabel(item, today) {
  const days = daysUntilExpiry(item?.expiry, today);
  if (days == null) return '未設定期限';
  if (days === 0) return '今天到期';
  if (days > 0) return `還有 ${days} 天`;
  return `已過期 ${-days} 天`;
}

export function formatDate(iso) {
  if (!parseISODate(iso)) return '未設定';
  const [y, m, d] = iso.split('-');
  return `${y}/${m}/${d}`;
}

export function summarize(items, today) {
  const counts = { total: items.length, 正常: 0, 即將到期: 0, 已過期: 0 };
  for (const item of items) counts[itemStatus(item, today)] += 1;
  return counts;
}

export function filterAndSort(items, { area = '全部', status = '全部', sort = 'expiry-asc', today }) {
  let list = items.filter((item) => {
    if (area !== '全部' && item.area !== area) return false;
    if (status !== '全部' && itemStatus(item, today) !== status) return false;
    return true;
  });

  const areaIndex = (value) => {
    const index = AREAS.indexOf(value);
    return index === -1 ? AREAS.length : index;
  };

  list.sort((a, b) => {
    let cmp = 0;
    if (sort === 'expiry-asc' || sort === 'expiry-desc') {
      if (!a.expiry && !b.expiry) cmp = 0;
      else if (!a.expiry) cmp = 1;
      else if (!b.expiry) cmp = -1;
      else cmp = a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0;
      if (sort === 'expiry-desc' && a.expiry && b.expiry) cmp = -cmp;
    } else if (sort === 'name') {
      cmp = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    } else if (sort === 'area') {
      cmp = areaIndex(a.area) - areaIndex(b.area);
      if (cmp === 0) cmp = String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
    }
    if (cmp === 0) cmp = (a.createdAt || 0) - (b.createdAt || 0);
    return cmp;
  });

  return list;
}

export function summaryText(counts) {
  if (!counts.total) return '資料只留在這台裝置';
  const parts = [`共 ${counts.total} 項`];
  if (counts['即將到期']) parts.push(`${counts['即將到期']} 項即將到期`);
  if (counts['已過期']) parts.push(`${counts['已過期']} 項已過期`);
  if (!counts['即將到期'] && !counts['已過期']) parts.push('目前都在期限內');
  return parts.join(' · ');
}

export function leadHint(expiry, lead, today) {
  if (!expiry) return '設定到期日後，會依剩餘天數自動帶入提前提醒，仍可自行修改。';
  const days = daysUntilExpiry(expiry, today);
  if (days == null) return '到期日格式不正確。';
  const suggested = defaultLeadDays(days);
  const current = normalizeLeadDays(lead);
  const when = days < 0
    ? `已過期 ${-days} 天。`
    : days === 0
      ? '今天到期。'
      : `距離到期還有 ${days} 天。`;
  if (current === suggested) {
    return `${when}已依期限自動設定為到期前 ${current} 天提醒。`;
  }
  return `${when}到期前 ${current} 天提醒（已自行調整）。更改到期日會重新套用預設。`;
}
