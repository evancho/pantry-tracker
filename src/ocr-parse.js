/**
 * Pull a product name and expiry date out of on-device OCR text.
 * Taiwan packages mix western dates, 民國 years, and labels such as 有效期限.
 * Anything uncertain is left blank so the person can type it.
 */

const EXPIRY_HINT = /有效期限|有效日期|保存期限|賞味期限|到期日|到期|此日期前|消費期限|EXPIRY|EXP\b|BEST\s*BEFORE|B\.?\s*B\.?(?:\s*D\.?)?/i;
const MFG_HINT = /製造日期|生產日期|包裝日期|MFG|PROD/i;

const SKIP_LINE = /(成分|原料表|營養標示|營養成分|製造日期|生產日期|有效期限|有效日期|保存期限|賞味期限|到期日|消費期限|地址|電話|客服|產地|原產地|淨重|內容量|保存方法|食用方法|包裝日期|批號|條碼|www\.|https?:|BEST\s*BEFORE|EXPIRY|^EXP\b|有限公司|股份有限)/i;

export function normalizeOcrText(input) {
  return String(input || '')
    .replace(/\uFEFF/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/／/g, '/')
    .replace(/[－—–]/g, '-')
    .replace(/：/g, ':');
}

export function collapseCjkSpaces(input) {
  return String(input || '').replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1');
}

function toLines(input) {
  if (!input) return [];
  if (typeof input === 'string') {
    return input.split(/\r?\n/).map((text, order) => ({ text, height: 16, order, confidence: null }));
  }
  if (Array.isArray(input.lines) && input.lines.length) {
    return input.lines.map((line, order) => ({
      text: line.text || '',
      height: line.height
        || (line.bbox ? Math.max(0, line.bbox.y1 - line.bbox.y0) : 16),
      order,
      confidence: line.confidence ?? null,
    }));
  }
  return String(input.text || '').split(/\r?\n/).map((text, order) => ({
    text,
    height: 16,
    order,
    confidence: null,
  }));
}

function isRealDate(year, month, day) {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  return check.getUTCFullYear() === year
    && check.getUTCMonth() === month - 1
    && check.getUTCDate() === day;
}

function isoFromParts(year, month, day) {
  if (!isRealDate(year, month, day)) {
    if (month > 12 && day >= 1 && day <= 12 && isRealDate(year, day, month)) {
      return isoFromParts(year, day, month);
    }
    return null;
  }
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function resolveShortYear(year, minguo) {
  if (minguo) return year + 1911;
  if (year >= 100 && year <= 199) return year + 1911;
  if (year >= 0 && year <= 39) return 2000 + year;
  if (year >= 40 && year <= 99) return 1900 + year;
  return null;
}

function addCandidate(list, consumed, start, end, iso) {
  if (!iso) return;
  if (consumed.some(([s, e]) => start < e && end > s)) return;
  consumed.push([start, end]);
  list.push({ iso, index: start });
}

export function extractExpiry(rawText) {
  const text = normalizeOcrText(rawText);
  const found = [];
  const consumed = [];

  const western = /(\d{4})\s*[./\-年]\s*(\d{1,2})\s*[./\-月]\s*(\d{1,2})\s*日?/g;
  for (const match of text.matchAll(western)) {
    addCandidate(
      found,
      consumed,
      match.index,
      match.index + match[0].length,
      isoFromParts(Number(match[1]), Number(match[2]), Number(match[3])),
    );
  }

  const dayFirst = /(?<!\d)(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{4})(?!\d)/g;
  for (const match of text.matchAll(dayFirst)) {
    addCandidate(
      found,
      consumed,
      match.index,
      match.index + match[0].length,
      isoFromParts(Number(match[3]), Number(match[2]), Number(match[1])),
    );
  }

  const shortYear = /(?<!\d)(民國\s*)?(\d{2,3})\s*[./\-年]\s*(\d{1,2})\s*[./\-月]\s*(\d{1,2})\s*日?(?!\d)/g;
  for (const match of text.matchAll(shortYear)) {
    const year = resolveShortYear(Number(match[2]), Boolean(match[1]));
    addCandidate(
      found,
      consumed,
      match.index,
      match.index + match[0].length,
      year ? isoFromParts(year, Number(match[3]), Number(match[4])) : null,
    );
  }

  const compact = /(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g;
  for (const match of text.matchAll(compact)) {
    const start = match.index;
    const around = text.slice(Math.max(0, start - 24), start + match[0].length);
    if (!EXPIRY_HINT.test(around)) continue;
    addCandidate(
      found,
      consumed,
      start,
      start + match[0].length,
      isoFromParts(Number(match[1]), Number(match[2]), Number(match[3])),
    );
  }

  if (!found.length) return null;

  const scored = new Map();
  for (const candidate of found) {
    const score = scoreDate(text, candidate.index);
    const prev = scored.get(candidate.iso);
    if (!prev || score > prev.score) scored.set(candidate.iso, { iso: candidate.iso, score });
  }

  const ranked = [...scored.values()].sort((a, b) => b.score - a.score || b.iso.localeCompare(a.iso));
  return ranked[0]?.iso || null;
}

function lineAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return {
    line: text.slice(start, end === -1 ? text.length : end),
    start,
  };
}

function scoreDate(text, index) {
  const { line, start } = lineAt(text, index);
  const before = text.slice(Math.max(0, index - 18), index);
  const prevBreak = text.lastIndexOf('\n', start - 2);
  const prevLine = start > 0 ? text.slice(prevBreak + 1, start - 1) : '';
  let score = 1;
  if (EXPIRY_HINT.test(line) || EXPIRY_HINT.test(before)) score += 50;
  if (EXPIRY_HINT.test(prevLine) && !EXPIRY_HINT.test(line)) score += 40;
  if (MFG_HINT.test(line) && !EXPIRY_HINT.test(line)) score -= 25;
  if (MFG_HINT.test(prevLine) && !EXPIRY_HINT.test(line) && !EXPIRY_HINT.test(prevLine.replace(MFG_HINT, ''))) {
    score -= 20;
  }
  return score;
}

function cleanLine(text) {
  return collapseCjkSpaces(normalizeOcrText(text))
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractName(lines) {
  let best = '';
  let bestScore = 0;
  lines.forEach((line, order) => {
    const text = cleanLine(line.text);
    if (text.length < 2 || text.length > 40) return;
    if (SKIP_LINE.test(text)) return;
    if (extractExpiry(text) && !/[\u3400-\u9fff]{2,}/.test(text.replace(/\d+/g, ''))) return;
    const confidence = line.confidence;
    if (typeof confidence === 'number' && confidence > 0 && confidence < 30) return;
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = /[A-Za-z]{3,}/.test(text);
    if (cjk < 2 && !latin) return;
    const height = line.height || 16;
    let score = Math.min(cjk, 10) * 2;
    score += Math.min(height, 120) / 2;
    score += Math.max(0, 4 - (line.order ?? order)) * 1.5;
    if (cjk >= 2 && cjk <= 14) score += 6;
    if (latin && cjk === 0) score += 8;
    if (text.length > 24) score -= 6;
    if (/^\d+$/.test(text.replace(/\s/g, ''))) return;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  });
  return best || null;
}

export function parseLabel(input) {
  const lines = toLines(input).map((line) => ({
    ...line,
    text: cleanLine(line.text),
  })).filter((line) => line.text);
  const rawText = lines.map((line) => line.text).join('\n');
  return {
    name: extractName(lines),
    expiry: extractExpiry(rawText),
    rawText,
  };
}
