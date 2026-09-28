const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function bytesToBase64Url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function jsonBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem) {
  const b64 = String(pem || '').replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  if (!b64) return null;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function serviceAccountAccessToken(jsonText, fetchImpl = fetch, now = Date.now()) {
  const raw = String(jsonText || '').trim();
  if (!raw) return { ok: false, reason: 'missing-service-account' };
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid-service-account' };
  }
  const pkcs8 = pemToBytes(key?.private_key);
  if (!key?.client_email || !pkcs8) return { ok: false, reason: 'invalid-service-account' };
  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return { ok: false, reason: 'invalid-service-account' };
  }
  const issued = Math.floor(now / 1000);
  const unsigned = `${jsonBase64Url({ alg: 'RS256', typ: 'JWT' })}.${jsonBase64Url({
    iss: key.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: issued,
    exp: issued + 3600,
  })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${bytesToBase64Url(signature)}`;
  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch {
    return { ok: false, reason: 'token-network' };
  }
  if (!response?.ok) return { ok: false, reason: 'token-rejected', status: response?.status || 0 };
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!body.access_token) return { ok: false, reason: 'token-rejected' };
  return { ok: true, accessToken: body.access_token, clientEmail: key.client_email };
}
