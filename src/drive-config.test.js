import { describe, expect, it } from 'vitest';
import { driveErrorMessage, readDriveConfig } from './drive-config.js';
import { driveFolderLink, parseDriveFolderId } from './sync.js';

describe('drive config', () => {
  it('stays local until a Google client id is present', () => {
    expect(readDriveConfig({}).configured).toBe(false);
    expect(readDriveConfig({ VITE_GOOGLE_API_KEY: 'key' }).configured).toBe(false);
    const ready = readDriveConfig({
      VITE_GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
      VITE_GOOGLE_API_KEY: 'key',
    });
    expect(ready.configured).toBe(true);
    expect(ready.config.clientId).toMatch(/googleusercontent/);
  });

  it('explains cancelled login and offline in Traditional Chinese', () => {
    expect(driveErrorMessage({ code: 'access_denied' })).toMatch(/取消/);
    expect(driveErrorMessage({ code: '403' })).toMatch(/編輯者/);
    expect(driveErrorMessage(new Error('Failed to fetch'))).toMatch(/這台裝置/);
  });
});

describe('drive folder links', () => {
  const id = '1AbC-def_234567890';

  it('reads a folder id from a link or a raw id', () => {
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}`)).toBe(id);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}?usp=sharing`)).toBe(id);
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${id}`)).toBe(id);
    expect(parseDriveFolderId(id)).toBe(id);
    expect(parseDriveFolderId('不是連結')).toBe('');
    expect(driveFolderLink(id)).toBe(`https://drive.google.com/drive/folders/${id}`);
  });
});
