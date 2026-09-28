import { describe, expect, it } from 'vitest';
import { isInstalledDisplay, updatePromptCopy } from './app-update.js';

function media(matches) {
  return (query) => ({ matches: Boolean(matches[query]) });
}

describe('installed update prompt', () => {
  it('detects a home-screen install', () => {
    expect(isInstalledDisplay({}, media({ '(display-mode: standalone)': true }))).toBe(true);
    expect(isInstalledDisplay({}, media({ '(display-mode: fullscreen)': true }))).toBe(true);
    expect(isInstalledDisplay({ standalone: true }, media({}))).toBe(true);
    expect(isInstalledDisplay({}, media({}))).toBe(false);
  });

  it('asks installed apps to update in plain language', () => {
    const installed = updatePromptCopy(true);
    expect(installed.banner).toContain('主畫面');
    expect(installed.title).toContain('更新');
    expect(installed.body).toContain('立即更新');
    expect(updatePromptCopy(false).title).toBe('有新版本');
    expect(updatePromptCopy(false).body).toContain('立即更新');
  });
});
