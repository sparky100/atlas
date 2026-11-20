import { describe, expect, it } from 'vitest';
import { cancelReasonText } from './cancelReasonText';

describe('cancelReasonText', () => {
  it('drops the decision id from the automatic reason', () => {
    expect(cancelReasonText('Decision cancelled: see decision d2f9b167-0502-402c-83a2-221bd0f732c1')).toBe('Its decision was cancelled.');
  });
  it('leaves a typed reason alone', () => {
    expect(cancelReasonText('not required')).toBe('not required');
  });
});
