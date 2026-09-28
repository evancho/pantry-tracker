import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { CHANGELOG } from './changelog.js';

describe('changelog', () => {
  it('lists this release first and keeps the 1.0.0 summary', () => {
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(CHANGELOG.map((entry) => entry.version)).toContain('1.0.0');
    expect(CHANGELOG[0].summary).toMatch(/名稱/);
    expect(CHANGELOG[0].changes.join('\n')).toMatch(/單欄/);
    expect(CHANGELOG.at(-1).changes.join('\n')).toMatch(/這台裝置/);
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });
});
