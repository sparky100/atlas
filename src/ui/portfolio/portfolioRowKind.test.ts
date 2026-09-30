import { describe, expect, it } from 'vitest';
import { rowKindOf } from './portfolioRowKind';
import { fakeElement } from './portfolioTestFixtures';

describe('rowKindOf', () => {
  it('is "system" for an ordinary system', () => {
    expect(rowKindOf(fakeElement('s', 'system'))).toBe('system');
  });

  it('is "platform" for a system with kind: platform', () => {
    expect(rowKindOf(fakeElement('p', 'system', { kind: 'platform' }))).toBe('platform');
  });

  it('is "module" for any container', () => {
    expect(rowKindOf(fakeElement('m', 'container'))).toBe('module');
  });
});
