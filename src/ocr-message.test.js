import { describe, expect, it } from 'vitest';
import { describeOcrError } from './ocr-message.js';

describe('describeOcrError', () => {
  it('explains a timeout separately from a failed engine load', () => {
    expect(describeOcrError(new Error('辨識逾時'))).toMatch(/逾時/);
    expect(describeOcrError('Network error while fetching tessdata')).toMatch(/不會上傳照片/);
    expect(describeOcrError(new Error('something else'))).toMatch(/手動輸入/);
  });
});