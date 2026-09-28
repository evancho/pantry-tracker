import { LINE_BOT_NAME } from '../../../src/line-config.js';
import {
  composeLineMessage,
  taipeiTodayISO,
  workerReadiness,
} from '../../../src/line-subscribers.js';
import { readFolderReminderData } from './drive-read.js';
import { serviceAccountAccessToken } from './google-jwt.js';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function json(body, status = 200) {
  return Response.json(body, { status });
}

async function lineSignature(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  let binary = '';
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function signaturesMatch(actual, expected) {
  const left = String(actual || '');
  const right = String(expected || '');
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function pushLineText({ token, to, text, fetchImpl = fetch }) {
  if (!String(token || '').trim()) return { ok: false, skipped: true, reason: 'missing-token' };
  if (!to || !text) return { ok: false, skipped: true, reason: 'nothing-to-send' };
  let response;
  try {
    response = await fetchImpl(PUSH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    });
  } catch {
    return { ok: false, reason: 'push-network' };
  }
  if (!response?.ok) return { ok: false, reason: 'push-rejected', status: response?.status || 0 };
  return { ok: true };
}

async function alreadySent(env, key) {
  if (!env?.LINE_REMIND_KV?.get) return false;
  try {
    return Boolean(await env.LINE_REMIND_KV.get(key));
  } catch {
    return false;
  }
}

async function rememberSent(env, key) {
  if (!env?.LINE_REMIND_KV?.put) return;
  try {
    await env.LINE_REMIND_KV.put(key, '1', { expirationTtl: 60 * 60 * 36 });
  } catch {
    // Dedupe is optional. A failed write still leaves the push result intact.
  }
}

export async function runLineReminders(env = {}, { fetchImpl = fetch, now = new Date() } = {}) {
  const status = workerReadiness(env);
  if (!status.ready) return { ok: false, skipped: true, missing: status.missing };
  const token = await serviceAccountAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON, fetchImpl, now.getTime());
  if (!token.ok) return { ok: false, skipped: true, reason: token.reason };
  const today = taipeiTodayISO(now);
  const folders = [];
  for (const folderId of status.folders) {
    const folder = { id: folderId, pushed: 0, skipped: 0, errors: [] };
    try {
      const data = await readFolderReminderData(folderId, token.accessToken, fetchImpl);
      if (data.subscribers.enabled === false) {
        folder.skippedReason = 'disabled';
        folders.push(folder);
        continue;
      }
      const text = composeLineMessage(data.items, today, { botName: LINE_BOT_NAME });
      if (!text) {
        folder.skippedReason = 'nothing-due';
        folders.push(folder);
        continue;
      }
      for (const subscriber of data.subscribers.subscribers) {
        const dedupeKey = `${folderId}:${subscriber.userId}:${today}`;
        if (await alreadySent(env, dedupeKey)) {
          folder.skipped += 1;
          continue;
        }
        const pushed = await pushLineText({
          token: env.LINE_CHANNEL_ACCESS_TOKEN,
          to: subscriber.userId,
          text,
          fetchImpl,
        });
        if (pushed.ok) {
          folder.pushed += 1;
          await rememberSent(env, dedupeKey);
        } else {
          folder.errors.push({ userId: subscriber.userId, reason: pushed.reason || 'push-failed' });
        }
      }
    } catch (error) {
      folder.errors.push({ reason: error?.message || 'folder-failed' });
    }
    folders.push(folder);
  }
  return { ok: true, skipped: false, today, folders };
}

export async function handleLineRequest(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    const status = workerReadiness(env);
    return json({
      ok: true,
      bot: LINE_BOT_NAME,
      ready: status.ready,
      missing: status.missing,
      channelSecret: status.lineSecretSet,
      kv: status.kvBound,
    });
  }
  if (request.method === 'POST' && url.pathname === '/webhook') {
    const secret = String(env.LINE_CHANNEL_SECRET || '').trim();
    if (!secret) return json({ ok: false, reason: 'channel-secret-not-set' });
    const body = await request.text();
    const expected = await lineSignature(body, secret);
    if (!signaturesMatch(request.headers.get('x-line-signature'), expected)) {
      return json({ ok: false, reason: 'bad-signature' }, 401);
    }
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      return json({ ok: false, reason: 'bad-json' });
    }
    const follows = [];
    for (const event of Array.isArray(payload.events) ? payload.events : []) {
      if (event?.type === 'follow' && event.source?.userId) follows.push(event.source.userId);
    }
    if (follows.length) console.log(`LINE follow userId: ${follows.join(',')}`);
    return json({ ok: true, follows });
  }
  return json({ ok: false, reason: 'not-found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleLineRequest(request, env);
    } catch (error) {
      console.error(error);
      return json({ ok: false, reason: 'error' });
    }
  },
  async scheduled(_event, env, ctx) {
    const run = runLineReminders(env).then((result) => {
      const summary = result.skipped
        ? { lineRemind: 'skipped', missing: result.missing, reason: result.reason }
        : { lineRemind: 'done', today: result.today, folders: (result.folders || []).map((folder) => ({ id: folder.id, pushed: folder.pushed, skipped: folder.skippedReason || folder.skipped })) };
      console.log(JSON.stringify(summary));
      return result;
    }).catch((error) => {
      console.error(error);
      return { ok: false, skipped: true, reason: 'error' };
    });
    if (ctx?.waitUntil) ctx.waitUntil(run);
    else await run;
  },
};
