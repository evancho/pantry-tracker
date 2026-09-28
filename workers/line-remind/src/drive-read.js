import { LINE_SUBSCRIBERS_FILE } from '../../../src/line-config.js';
import { parseLineSubscribers } from '../../../src/line-subscribers.js';

async function driveJson(url, accessToken, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response?.ok) {
    const error = new Error(`Drive ${response?.status || 0}`);
    error.status = response?.status || 0;
    throw error;
  }
  return response.json();
}

export async function readFolderReminderData(folderId, accessToken, fetchImpl = fetch) {
  const files = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name)');
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await driveJson(url, accessToken, fetchImpl);
    files.push(...(body.files || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  const wanted = files.filter((file) => file.name === LINE_SUBSCRIBERS_FILE || /^item-.+\.json$/.test(file.name || ''));
  const items = [];
  let subscribers = parseLineSubscribers('');
  let sawSubscribers = false;
  for (const file of wanted) {
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response?.ok) continue;
    const text = await response.text();
    if (file.name === LINE_SUBSCRIBERS_FILE) {
      subscribers = parseLineSubscribers(text);
      sawSubscribers = true;
      continue;
    }
    try {
      const item = JSON.parse(text);
      if (item && typeof item === 'object') items.push(item);
    } catch {
      // A broken item file should not stop the rest of the folder.
    }
  }
  return { items, subscribers, sawSubscribers };
}
