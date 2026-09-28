import { describe, expect, it } from 'vitest';
import { buttonAuthSteps, isUserCancel, reauthCopy, silentAuthPrompt } from './auth-restore.js';

describe('remembered Google account', () => {
  const user = { email: 'ming.rock7552@gmail.com', displayName: 'Ming' };

  it('keeps a quiet prompt for reopen, and a one-tap prompt before the account picker', () => {
    expect(silentAuthPrompt()).toBe('none');
    expect(buttonAuthSteps(user.email)).toEqual([
      { prompt: '', hint: user.email },
      { prompt: 'select_account', hint: user.email },
    ]);
    expect(buttonAuthSteps('')).toEqual([{ prompt: 'select_account', hint: '' }]);
  });

  it('does not open the account picker after the person cancels', () => {
    expect(isUserCancel({ code: 'popup_closed_by_user' })).toBe(true);
    expect(isUserCancel({ code: 'access_denied' })).toBe(true);
    expect(isUserCancel({ code: 'interaction_required' })).toBe(false);
  });

  it('explains that the account is still remembered', () => {
    expect(reauthCopy(user, 'Evan Home')).toMatch(/已記住 ming\.rock7552@gmail\.com/);
    expect(reauthCopy(user, 'Evan Home')).toMatch(/Evan Home/);
    expect(reauthCopy(user, 'Evan Home')).toMatch(/使用 Google 登入/);
    expect(reauthCopy(user)).toMatch(/清單仍可查看與修改/);
  });
});
