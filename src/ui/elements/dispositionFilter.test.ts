import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { matchesDispositionFilter } from './useElementBrowse';

function el(type: ElementsHeadRow['element_type']): ElementsHeadRow {
  return { element_id: 'e', element_type: type, name: 'E', parent_id: null, attributes: {}, exists_delta_id: 'd' };
}

describe('browse disposition filter (F11)', () => {
  it('matches one value exactly; "not assessed" means a system or module with none recorded', () => {
    expect(matchesDispositionFilter({ element: el('system'), disposition: 'migrate' }, 'migrate')).toBe(true);
    expect(matchesDispositionFilter({ element: el('system'), disposition: 'invest' }, 'migrate')).toBe(false);
    expect(matchesDispositionFilter({ element: el('system'), disposition: null }, 'not_assessed')).toBe(true);
    expect(matchesDispositionFilter({ element: el('container'), disposition: null }, 'not_assessed')).toBe(true);
    // A capability never carries the attribute, so it is never "not assessed".
    expect(matchesDispositionFilter({ element: el('capability'), disposition: null }, 'not_assessed')).toBe(false);
    expect(matchesDispositionFilter({ element: el('capability'), disposition: null }, 'all')).toBe(true);
  });
});
