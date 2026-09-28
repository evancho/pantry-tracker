const CANCEL_CODES = new Set(['popup_closed', 'access_denied', 'popup_closed_by_user']);

export function isUserCancel(error) {
  const code = String(error?.code || error?.message || '');
  return CANCEL_CODES.has(code);
}

/** No UI. Used when the app opens or comes back online, before any tap. */
export function silentAuthPrompt() {
  return 'none';
}

/**
 * Button press. A remembered account tries the quietest GIS prompt first,
 * then the account picker. A new login goes straight to the picker.
 * A cancelled prompt does not continue.
 */
export function buttonAuthSteps(rememberedEmail) {
  const hint = String(rememberedEmail || '').trim();
  if (!hint) return [{ prompt: 'select_account', hint: '' }];
  return [
    { prompt: '', hint },
    { prompt: 'select_account', hint },
  ];
}

export function reauthCopy(user, activeName = '') {
  const who = user?.email || user?.displayName || '';
  const remembered = who ? `已記住 ${who}` : '已記住帳號';
  if (activeName) {
    return `${remembered}。請再按一次「使用 Google 登入」。這台裝置仍顯示「${activeName}」。`;
  }
  return `${remembered}。請再按一次「使用 Google 登入」。這台裝置上的清單仍可查看與修改。`;
}
