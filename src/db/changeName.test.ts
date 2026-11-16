import { describe, expect, it } from 'vitest';
import { changeNameFromTitle } from './branches';

describe('changeNameFromTitle', () => {
  const id = '1234abcd-0000-4000-8000-000000000000';
  it('makes a short code from the plain title and the id', () => {
    expect(changeNameFromTitle('Retire the legacy CRM', id)).toBe('retire-the-legacy-crm-1234abcd');
  });
  it('is stable for the same inputs and differs for two ids with the same title', () => {
    expect(changeNameFromTitle('Same', id)).toBe(changeNameFromTitle('Same', id));
    expect(changeNameFromTitle('Same', id)).not.toBe(changeNameFromTitle('Same', 'ffffffff-0000-4000-8000-000000000000'));
  });
  it('copes with empty, symbol-only and very long titles', () => {
    expect(changeNameFromTitle('', id)).toBe('change-1234abcd');
    expect(changeNameFromTitle('???', id)).toBe('change-1234abcd');
    const long = changeNameFromTitle('word '.repeat(40), id);
    expect(long.length).toBeLessThanOrEqual(50 + 9);
    expect(long).not.toMatch(/--/);
  });
});
