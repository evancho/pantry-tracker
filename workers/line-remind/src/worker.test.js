import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleLineRequest, runLineReminders } from './index.js';

const USER = `U${'ab'.repeat(16)}`;

function serviceAccountJson() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return JSON.stringify({
    client_email: 'pantry-remind@example.iam.gserviceaccount.com',
    private_key: pem,
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('line remind worker', () => {
  it('skips the cron run when secrets are empty', async () => {
    let called = false;
    const result = await runLineReminders({}, {
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    expect(result.skipped).toBe(true);
    expect(result.missing).toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(called).toBe(false);
  });

  it('skips an unreadable service account instead of throwing', async () => {
    const result = await runLineReminders({
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      GOOGLE_SERVICE_ACCOUNT_JSON: '{',
      DRIVE_FOLDER_IDS: 'folderEnabled',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid-service-account');
  });

  it('answers health and webhook without a channel secret', async () => {
    const health = await handleLineRequest(new Request('https://remind.example/health'), {});
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.bot).toBe('生活提醒');
    expect(healthBody.ready).toBe(false);
    expect(healthBody.missing).toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(JSON.stringify(healthBody)).not.toMatch(/ya29|BEGIN PRIVATE KEY/);

    const webhook = await handleLineRequest(new Request('https://remind.example/webhook', {
      method: 'POST',
      body: '{}',
    }), {});
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toEqual({ ok: false, reason: 'channel-secret-not-set' });
  });

  it('rejects a bad webhook signature and accepts a real one', async () => {
    const env = { LINE_CHANNEL_SECRET: 'channel-secret' };
    const bad = await handleLineRequest(new Request('https://remind.example/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': 'nope' },
      body: '{}',
    }), env);
    expect(bad.status).toBe(401);

    const body = JSON.stringify({ events: [{ type: 'follow', source: { userId: USER } }] });
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    let binary = '';
    for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
    const good = await handleLineRequest(new Request('https://remind.example/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': btoa(binary) },
      body,
    }), env);
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ ok: true, follows: [USER] });
  });

  it('pushes one message per bound user and skips a disabled folder', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('oauth2.googleapis.com/token')) return jsonResponse({ access_token: 'ya29.test', expires_in: 3600 });
      if (href.includes('api.line.me')) return jsonResponse({ ok: true });
      if (href.includes('alt=media')) {
        if (href.includes('sub-off')) {
          return new Response(JSON.stringify({ version: 1, enabled: false, subscribers: [{ userId: USER }] }));
        }
        if (href.includes('sub-on')) {
          return new Response(JSON.stringify({
            version: 1,
            enabled: true,
            subscribers: [{ userId: USER, label: '媽媽' }, { userId: `U${'cd'.repeat(16)}`, label: '' }],
          }));
        }
        if (href.includes('item-milk')) {
          return new Response(JSON.stringify({ name: '牛奶', expiry: '2026-09-28', leadDays: 1 }));
        }
        if (href.includes('item-rice')) {
          return new Response(JSON.stringify({ name: '米', expiry: '2026-12-01', leadDays: 1 }));
        }
      }
      if (href.includes('drive/v3/files')) {
        if (href.includes('folderDisabled')) {
          return jsonResponse({ files: [{ id: 'sub-off', name: 'line-subscribers.json' }] });
        }
        return jsonResponse({
          files: [
            { id: 'sub-on', name: 'line-subscribers.json' },
            { id: 'item-milk', name: 'item-milk.json' },
            { id: 'item-rice', name: 'item-rice.json' },
          ],
        });
      }
      return jsonResponse({ error: 'unexpected' }, 404);
    };

    const result = await runLineReminders({
      LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson(),
      DRIVE_FOLDER_IDS: 'folderEnabled,folderDisabled',
    }, { fetchImpl, now: new Date('2026-09-28T00:30:00+08:00') });

    expect(result.ok).toBe(true);
    expect(result.folders[0].pushed).toBe(2);
    expect(result.folders[1].skippedReason).toBe('disabled');
    const pushes = calls.filter((href) => href.includes('api.line.me'));
    expect(pushes).toHaveLength(2);
    expect(calls.some((href) => href.includes('line-token'))).toBe(false);
  });
});
