import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { CHANGELOG } from './changelog.js';

describe('changelog', () => {
  it('lists this release first and keeps the 1.0.0 summary', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(CHANGELOG.map((entry) => entry.version)).toEqual(['2.1.6', '2.1.5', '2.1.4', '2.1.3', '2.1.2', '2.1.1', '2.1.0', '2.0.0', '1.2.1', '1.2.0', '1.1.0', '1.0.0']);
    expect(CHANGELOG[0].summary).toMatch(/帳號/);
    expect(CHANGELOG[0].changes.join('\n')).toMatch(/登出/);
    const statusHead = CHANGELOG.find((entry) => entry.version === '2.1.5');
    expect(statusHead.summary).toMatch(/目前狀態/);
    expect(statusHead.changes.join('\n')).toMatch(/立即同步/);
    const cards = CHANGELOG.find((entry) => entry.version === '2.1.4');
    expect(cards.summary).toMatch(/家庭同步/);
    expect(cards.changes.join('\n')).toMatch(/邀請家人/);
    const overlay = CHANGELOG.find((entry) => entry.version === '2.1.3');
    expect(overlay.summary).toMatch(/更多/);
    const polish = CHANGELOG.find((entry) => entry.version === '2.1.2');
    expect(polish.summary).toMatch(/精緻/);
    const sync = CHANGELOG.find((entry) => entry.version === '2.1.1');
    expect(sync.changes.join('\n')).toMatch(/尚未登入/);
    expect(sync.changes.join('\n')).toMatch(/已同步/);
    const drive = CHANGELOG.find((entry) => entry.version === '2.1.0');
    expect(drive.summary).toMatch(/家人/);
    expect(drive.changes.join('\n')).toMatch(/Google/);
    const toolbar = CHANGELOG.find((entry) => entry.version === '1.2.1');
    expect(toolbar.summary).toMatch(/排序/);
    expect(toolbar.changes.join('\n')).toMatch(/同一列/);
    const modes = CHANGELOG.find((entry) => entry.version === '1.2.0');
    expect(modes.summary).toMatch(/簡易模式/);
    expect(modes.changes.join('\n')).toMatch(/拍照辨識/);
    const previous = CHANGELOG.find((entry) => entry.version === '1.1.0');
    expect(previous.summary).toMatch(/名稱/);
    expect(previous.changes.join('\n')).toMatch(/單欄/);
    expect(CHANGELOG.at(-1).changes.join('\n')).toMatch(/這台裝置/);
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });
});
