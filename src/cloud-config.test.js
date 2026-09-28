import { describe, expect, it } from 'vitest';
import { cloudErrorMessage, readCloudConfig } from './cloud-config.js';

describe('cloud config', () => {
  it('stays local when any required Firebase value is missing', () => {
    expect(readCloudConfig({}).configured).toBe(false);
    expect(readCloudConfig({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'pantry',
      VITE_FIREBASE_APP_ID: '1',
    }).configured).toBe(false);
    const ready = readCloudConfig({
      VITE_FIREBASE_API_KEY: 'k',
      VITE_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'pantry',
      VITE_FIREBASE_STORAGE_BUCKET: 'pantry.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
      VITE_FIREBASE_APP_ID: '1:1:web:abc',
    });
    expect(ready.configured).toBe(true);
    expect(ready.config.projectId).toBe('pantry');
  });

  it('explains auth and offline failures in Traditional Chinese', () => {
    expect(cloudErrorMessage({ code: 'auth/email-already-in-use' })).toMatch(/登入/);
    expect(cloudErrorMessage({ code: 'auth/popup-blocked' })).toMatch(/電子郵件/);
    expect(cloudErrorMessage(new Error('Failed to fetch'))).toMatch(/這台裝置/);
  });
});