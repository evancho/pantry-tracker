/** Public LINE official-account settings. Channel tokens never belong here. */
export const LINE_BOT_NAME = '生活提醒';
export const LINE_SUBSCRIBERS_FILE = 'line-subscribers.json';

export function readLinePublicConfig(env = {}) {
  const addFriendUrl = String(env.VITE_LINE_ADD_FRIEND_URL || '').trim();
  return {
    botName: LINE_BOT_NAME,
    addFriendUrl,
    addFriendReady: /^https:\/\/\S+$/.test(addFriendUrl),
  };
}
