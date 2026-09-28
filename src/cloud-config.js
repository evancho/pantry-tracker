export function readCloudConfig(env = {}) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.VITE_FIREBASE_APP_ID || '',
  };
  const configured = Boolean(config.apiKey && config.authDomain && config.projectId && config.storageBucket && config.appId);
  return { config, configured };
}

export function cloudErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'auth/invalid-email') return '電子郵件格式不正確。';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return '電子郵件或密碼不正確。';
  }
  if (code === 'auth/email-already-in-use') return '這個電子郵件已經註冊，請改為登入。';
  if (code === 'auth/weak-password') return '密碼至少需要 6 個字元。';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '已取消 Google 登入。';
  if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
    return '這個畫面無法開啟 Google 視窗。請改用電子郵件登入，或用 Safari 打開網站後再登入。';
  }
  if (code === 'unavailable' || /network|offline|failed to fetch/i.test(String(error?.message || error || ''))) {
    return '現在沒有連線。資料已留在這台裝置，恢復網路後會再同步。';
  }
  return '雲端操作沒有完成，請再試一次。';
}
