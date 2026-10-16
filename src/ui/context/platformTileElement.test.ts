import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { platformTileElement } from './platformTileElement';

const el = (id: string, name: string): ElementsHeadRow => ({ element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: 'd' });

describe('platformTileElement', () => {
  const hub = el('hub', 'MuleSoft');
  const crm = el('crm', 'CRM');
  const endpoints = new Map([[crm.element_id, crm]]);

  it('finds the platform tile\'s element even though the endpoints map does not hold it', () => {
    expect(platformTileElement('hub', true, endpoints, hub)).toBe(hub);
  });

  it('finds an endpoint in the map, and nothing for an unknown id', () => {
    expect(platformTileElement('crm', false, endpoints, hub)).toBe(crm);
    expect(platformTileElement('ghost', false, endpoints, hub)).toBeUndefined();
  });
});
