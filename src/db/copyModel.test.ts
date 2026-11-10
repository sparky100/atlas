import { describe, expect, it } from 'vitest';
import { canCopyModel } from '../ui/orgs/roleGates';
import { defaultCopyName, slugForCopy } from './copyModel';

describe('defaultCopyName', () => {
  it('appends "(copy)", then "(copy 2)", "(copy 3)" while the name is taken (case-insensitive)', () => {
    expect(defaultCopyName('Distribution', ['Distribution'])).toBe('Distribution (copy)');
    expect(defaultCopyName('Distribution', ['Distribution', 'distribution (COPY)'])).toBe('Distribution (copy 2)');
    expect(defaultCopyName('Distribution', ['Distribution (copy)', 'Distribution (copy 2)'])).toBe('Distribution (copy 3)');
  });
});

describe('slugForCopy', () => {
  it('slugifies the name and avoids a clash', () => {
    expect(slugForCopy('Distribution (copy)', [])).toBe('distribution-copy');
    expect(slugForCopy('Distribution (copy)', ['distribution-copy'])).toBe('distribution-copy-2');
    expect(slugForCopy('!!!', [])).toBe('model');
  });
});

describe('canCopyModel', () => {
  it('shows the action to owners only', () => {
    expect(canCopyModel('owner')).toBe(true);
    for (const role of ['architect', 'contributor', 'viewer', null] as const) expect(canCopyModel(role)).toBe(false);
  });
});
