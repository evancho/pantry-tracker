export function readDriveConfig(env = {}) {
  const config = {
    clientId: env.VITE_GOOGLE_CLIENT_ID || '',
    apiKey: env.VITE_GOOGLE_API_KEY || '',
  };
  return { config, configured: Boolean(config.clientId) };
}

export function driveErrorMessage(error) {
  const code = String(error?.code || error?.status || '');
  const message = String(error?.message || error || '');
  if (code === 'popup_closed' || code === 'access_denied' || code === 'popup_closed_by_user') return '已取消 Google 登入。';
  if (code === 'popup_blocked_by_browser') return '瀏覽器擋住了 Google 視窗。請允許彈出視窗後再登入。';
  if (code === 'interaction_required') return '請再按一次「使用 Google 登入」。';
  if (code === '401') return 'Google 登入已過期，請重新登入。';
  if (code === '403') return '沒有這個資料夾的編輯權限。請請家人把雲端硬碟資料夾分享為「編輯者」。';
  if (code === '404') return '找不到這個雲端硬碟資料夾。請確認連結，以及你的 Google 帳號看得到它。';
  if (/network|offline|failed to fetch|無法載入 google/i.test(message)) {
    return '現在沒有連線。資料已留在這台裝置，恢復網路後會再同步。';
  }
  if (/[\u4e00-\u9fff]/.test(message) && !error?.code) return message;
  return 'Google 雲端硬碟沒有完成同步，請再試一次。';
}
