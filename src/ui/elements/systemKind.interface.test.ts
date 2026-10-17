import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { interfaceTypeLabelOf } from './systemKind';

const withAttrs = (attributes: Record<string, unknown>) => ({ attributes }) as unknown as ElementsHeadRow;

describe('interfaceTypeLabelOf', () => {
  it('returns the display label of a recorded interface type', () => {
    expect(interfaceTypeLabelOf(withAttrs({ interfaceType: 'api' }))).toBe('API');
    expect(interfaceTypeLabelOf(withAttrs({ interfaceType: 'event' }))).toBe('Event (topic or queue)');
  });
  it('returns null when absent or not a known type', () => {
    expect(interfaceTypeLabelOf(withAttrs({}))).toBeNull();
    expect(interfaceTypeLabelOf(withAttrs({ interfaceType: 'bogus' }))).toBeNull();
  });
});
