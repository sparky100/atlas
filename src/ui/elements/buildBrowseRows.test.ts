import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { buildBrowseRows } from './buildBrowseRows';

function el(id: string, type: ElementsHeadRow['element_type'], attributes: ElementsHeadRow['attributes'], parent: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parent, attributes, exists_delta_id: `d-${id}` };
}

describe('buildBrowseRows', () => {
  const platform = el('p', 'system', { lifecycleStatus: 'active', criticality: 'high' });
  const module_ = el('m', 'container', { disposition: 'migrate' }, 'p');
  const cap = el('c', 'capability', { lifecycleStatus: 'active' });
  const owner = el('o', 'actor', {});
  const rows = buildBrowseRows([platform, module_, cap], new Map([['m', owner]]));

  it('a module inherits its platform lifecycle and criticality', () => {
    const m = rows.find((r) => r.element.element_id === 'm');
    expect(m?.lifecycleStatus).toBe('active');
    expect(m?.criticality).toBe('high');
    expect(m?.parent?.element_id).toBe('p');
    expect(m?.owner?.element_id).toBe('o');
    expect(m?.disposition).toBe('migrate');
  });
  it('only systems and modules carry lifecycle and disposition', () => {
    const c = rows.find((r) => r.element.element_id === 'c');
    expect(c?.lifecycleStatus).toBeNull();
    expect(c?.disposition).toBeNull();
  });
});
