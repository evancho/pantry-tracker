import {
  AREAS,
  isValidArea,
  normalizeLeadDays,
  parseISODate,
} from './domain.js';
import { APP_SLUG } from './version.js';

export function buildBackup(items, exportedAt = new Date().toISOString()) {
  return {
    app: APP_SLUG,
    version: 1,
    exportedAt,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      expiry: item.expiry || null,
      area: item.area,
      leadDays: normalizeLeadDays(item.leadDays),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      photo: item.photo || null,
    })),
  };
}

export function parseBackup(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('無法讀取這個備份檔。');
  }
  if (!data || data.app !== APP_SLUG || !Array.isArray(data.items)) {
    throw new Error('這不是食材櫃的備份檔。');
  }

  const items = [];
  let skipped = 0;
  const seen = new Set();
  for (const row of data.items) {
    const item = parseBackupItem(row);
    if (!item) {
      skipped += 1;
      continue;
    }
    if (seen.has(item.id)) {
      const index = items.findIndex((existing) => existing.id === item.id);
      items.splice(index, 1);
    }
    seen.add(item.id);
    items.push(item);
  }
  return { items, skipped, exportedAt: data.exportedAt || null };
}

function parseBackupItem(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name || '').trim();
  if (!name || name.length > 80) return null;
  if (!isValidArea(row.area)) return null;
  const expiry = row.expiry ? String(row.expiry) : null;
  if (expiry && !parseISODate(expiry)) return null;
  const photo = typeof row.photo === 'string' && row.photo.startsWith('data:image/')
    ? row.photo
    : null;
  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null,
    name,
    expiry,
    area: row.area,
    leadDays: normalizeLeadDays(row.leadDays),
    createdAt: Number.isFinite(row.createdAt) ? row.createdAt : null,
    updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : null,
    photo,
  };
}

export { AREAS };
