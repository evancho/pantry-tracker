import { describe, expect, it } from 'vitest';
import { extractExpiry, parseLabel } from './ocr-parse.js';

describe('parseLabel', () => {
  it('reads a western expiry and the product name', () => {
    const parsed = parseLabel('統一麵包\n有效期限：2026.12.31');
    expect(parsed.name).toBe('統一麵包');
    expect(parsed.expiry).toBe('2026-12-31');
  });

  it('prefers the expiry keyword over the manufacture date', () => {
    const parsed = parseLabel('製造日期 2024/01/02\n有效期限 2026/08/09\n高麗菜豬肉水餃');
    expect(parsed.expiry).toBe('2026-08-09');
    expect(parsed.name).toBe('高麗菜豬肉水餃');
  });

  it('converts 民國 years on Taiwan packages', () => {
    const parsed = parseLabel('有效日期 115.06.30\n米血糕');
    expect(parsed.expiry).toBe('2026-06-30');
    expect(parsed.name).toBe('米血糕');
    expect(extractExpiry('民國98.01.02')).toBe('2009-01-02');
  });

  it('reads imported BEST BEFORE and EXP dates', () => {
    expect(parseLabel('EXP 15/03/2027\nOat Milk')).toMatchObject({
      expiry: '2027-03-15',
      name: 'Oat Milk',
    });
    expect(extractExpiry('BEST BEFORE 31.12.2028')).toBe('2028-12-31');
    expect(extractExpiry('賞味期限\n2027年1月5日')).toBe('2027-01-05');
    expect(extractExpiry('保存期限：2026年8月9日')).toBe('2026-08-09');
  });

  it('normalizes fullwidth digits and compact dates next to a keyword', () => {
    expect(extractExpiry('有效期限：２０２６．１２．３１')).toBe('2026-12-31');
    expect(extractExpiry('有效期限 20261231')).toBe('2026-12-31');
    expect(extractExpiry('4710123456789')).toBe(null);
  });

  it('picks the later date when nothing is labeled', () => {
    expect(extractExpiry('2024.01.01\n2026.05.01')).toBe('2026-05-01');
  });

  it('skips ingredient lines and prefers larger title text', () => {
    const parsed = parseLabel({
      lines: [
        { text: '成分：水、糖、鹽', bbox: { y0: 0, y1: 14 } },
        { text: '小字說明不要當名稱', bbox: { y0: 20, y1: 34 } },
        { text: '鮮奶', bbox: { y0: 40, y1: 110 } },
      ],
    });
    expect(parsed.name).toBe('鮮奶');
  });

  it('returns nothing usable for unrelated text', () => {
    expect(parseLabel('www.example.com')).toMatchObject({ name: null, expiry: null });
    expect(extractExpiry('這包沒有日期')).toBe(null);
  });
});
