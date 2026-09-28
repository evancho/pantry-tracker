import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { formatVersionLabel, taipeiDatecode } from '../scripts/version-label.mjs';
import { APP_DATECODE, APP_VERSION, APP_VERSION_LABEL } from './version.js';

describe('version label', () => {
  it('builds a datecode in Asia/Taipei', () => {
    expect(taipeiDatecode(new Date('2026-09-27T16:30:00.000Z'))).toBe('20260928');
    expect(taipeiDatecode(new Date('2026-09-28T15:30:00.000Z'))).toBe('20260928');
    expect(taipeiDatecode(new Date('2026-09-28T16:30:00.000Z'))).toBe('20260929');
  });

  it('formats semver plus datecode', () => {
    expect(formatVersionLabel('1.1.0', '20260928')).toBe('1.1.0-20260928');
  });

  it('wires the running version from package.json and the build date', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_DATECODE).toBe(taipeiDatecode());
    expect(APP_VERSION_LABEL).toBe(`${pkg.version}-${APP_DATECODE}`);
    expect(APP_VERSION_LABEL).toMatch(/^\d+\.\d+\.\d+-\d{8}$/);
  });
});
