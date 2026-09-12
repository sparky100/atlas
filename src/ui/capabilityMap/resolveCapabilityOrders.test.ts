import { describe, expect, it } from 'vitest';
import { resolveOrders } from './resolveCapabilityOrders';
import type { ElementsHeadRow } from '../../contracts/rows';

function orderedCapability(id: string, name: string, order?: number): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: order !== undefined ? { order } : {}, exists_delta_id: `d-${id}` };
}

describe('resolveOrders (S1 item 13: order assigned on the fly when missing)', () => {
  it('returns the pair unchanged when both already have an order', () => {
    const a = orderedCapability('a', 'Alpha', 3);
    const b = orderedCapability('b', 'Beta', 7);
    expect(resolveOrders([a, b], a, b)).toEqual({ capabilityOrder: 3, neighborOrder: 7 });
  });

  it('assigns the missing capability one past the highest order among siblings, leaving the ordered neighbor untouched', () => {
    const a = orderedCapability('a', 'Alpha'); // no order
    const b = orderedCapability('b', 'Beta', 5);
    const c = orderedCapability('c', 'Gamma', 9);
    expect(resolveOrders([a, b, c], a, b)).toEqual({ capabilityOrder: 10, neighborOrder: 5 });
  });

  it('assigns the missing neighbor one past the highest order among siblings, leaving the ordered capability untouched', () => {
    const a = orderedCapability('a', 'Alpha', 5);
    const b = orderedCapability('b', 'Beta'); // no order
    const c = orderedCapability('c', 'Gamma', 9);
    expect(resolveOrders([a, b, c], a, b)).toEqual({ capabilityOrder: 5, neighborOrder: 10 });
  });

  it('assigns two fresh, distinct values when both are missing, lower one to whichever displays first among siblings', () => {
    const ordered = orderedCapability('ordered', 'Ordered', 4);
    const a = orderedCapability('a', 'Alpha'); // no order, sorts before b in `siblings`
    const b = orderedCapability('b', 'Beta'); // no order, sorts after a in `siblings`
    expect(resolveOrders([ordered, a, b], a, b)).toEqual({ capabilityOrder: 5, neighborOrder: 6 });
    // Same pair, swap which one is "capability" vs. "neighbor" — the lower
    // value still goes to whichever displays first in `siblings`, not
    // whichever argument position it's passed in.
    expect(resolveOrders([ordered, a, b], b, a)).toEqual({ capabilityOrder: 6, neighborOrder: 5 });
  });

  it('treats no sibling having any order as a highest-order of zero, so the first fresh value is 1', () => {
    const a = orderedCapability('a', 'Alpha');
    const b = orderedCapability('b', 'Beta');
    expect(resolveOrders([a, b], a, b)).toEqual({ capabilityOrder: 1, neighborOrder: 2 });
  });
});
