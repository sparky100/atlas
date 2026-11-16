/**
 * Shared `PortfolioRow`/`ElementsHeadRow` builders for this directory's own
 * test files — the same "one small local fixture module, not duplicated
 * per test file" shape as `portfolioOverlap.test.ts`'s own `system()`/
 * `container()`/`supports()` helpers, pulled out once a second test file
 * (`portfolioSort.test.ts`, `portfolioFilter.test.ts`,
 * `portfolioVisibility.test.ts`) needed the identical row shape.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { Json } from '../../contracts/rows';
import type { PortfolioRow } from './usePortfolio';

export function fakeElement(id: string, elementType: 'system' | 'container' = 'system', extraAttributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: elementType, name: id, parent_id: null, attributes: extraAttributes, exists_delta_id: `d-${id}` };
}

export function fakeRow(overrides: Partial<PortfolioRow> = {}): PortfolioRow {
  return {
    element: fakeElement('sys-1'),
    name: 'sys-1',
    topLevelSystemId: 'sys-1',
    cost: null,
    fit: null,
    criticality: null,
    disposition: null,
    lifecycleStatus: null,
    lifecycleState: 'active',
    lifecycleExposed: null,
    capabilities: [],
    businessOwner: null,
    ownsEdges: [],
    signals: [],
    missingInputs: [],
    ...overrides,
  };
}

/** A `supports` edge from `fromId` to `toId`, with optional attributes (e.g. `{ fitForPurpose: 'poor' }`). */
export function fakeSupportsEdge(fromId: string, toId: string, attributes: Record<string, Json> = {}): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes, exists_delta_id: `d-r-${fromId}-${toId}` };
}
