import { describe, expect, it } from 'vitest';
import { driveErrorMessage, readDriveConfig } from './drive-config.js';
import { visibleFolderEditors } from './drive.js';
import { remindersEnabled, setRemindersEnabled } from './notify.js';
import { driveFolderLink, parseDriveFolderId, syncDetailMessage } from './sync.js';

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
    expect(driveErrorMessage({ code: '403', message: 'The owner of a file cannot be removed.' })).toMatch(/擁有者/);
    expect(driveErrorMessage({ code: '404', message: 'Permission not found' })).toMatch(/分享已經不在/);
    expect(driveErrorMessage(new Error('Failed to fetch'))).toMatch(/這台裝置/);
    expect(driveErrorMessage(new Error('無法取消擁有者的分享。'))).toMatch(/擁有者/);
  });
});

describe('folder editors', () => {
  it('lists the owner without a remove action and keeps writer accounts', () => {
    const rows = visibleFolderEditors([
      { id: 'own', type: 'user', role: 'owner', emailAddress: 'owner@gmail.com', displayName: 'Owner' },
      { id: 'ed', type: 'user', role: 'writer', emailAddress: 'family@gmail.com', displayName: '家人' },
      { id: 'view', type: 'user', role: 'reader', emailAddress: 'view@gmail.com' },
      { id: 'gone', type: 'user', role: 'writer', emailAddress: 'old@gmail.com', deleted: true },
      { id: 'any', type: 'anyone', role: 'writer' },
    ], { selfEmail: 'Owner@gmail.com' });
    expect(rows.map((row) => row.email)).toEqual(['owner@gmail.com', 'family@gmail.com']);
    expect(rows[0]).toMatchObject({ role: 'owner', removable: false, self: true });
    expect(rows[1]).toMatchObject({ role: 'writer', removable: true, self: false });
  });
});

describe('sync detail copy', () => {
  it('drops the redundant synced sentence', () => {
    expect(syncDetailMessage('已與 Google 雲端硬碟同步')).toBe('');
    expect(syncDetailMessage('請再按一次「使用 Google 登入」。')).toMatch(/登入/);
  });
});

describe('reminder switch', () => {
  it('stays off without permission and remembers a local off switch', () => {
    const storage = {
      value: null,
      getItem() { return this.value; },
      setItem(_key, value) { this.value = value; },
    };
    expect(remindersEnabled('default', storage)).toBe(false);
    expect(remindersEnabled('denied', storage)).toBe(false);
    expect(remindersEnabled('granted', storage)).toBe(true);
    setRemindersEnabled(false, storage);
    expect(remindersEnabled('granted', storage)).toBe(false);
    setRemindersEnabled(true, storage);
    expect(remindersEnabled('granted', storage)).toBe(true);
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
