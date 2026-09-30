/**
 * Shared `PortfolioRow`/`ElementsHeadRow` builders for this directory's own
 * test files — the same "one small local fixture module, not duplicated
 * per test file" shape as `portfolioOverlap.test.ts`'s own `system()`/
 * `container()`/`supports()` helpers, pulled out once a second test file
 * (`portfolioSort.test.ts`, `portfolioFilter.test.ts`,
 * `portfolioVisibility.test.ts`) needed the identical row shape.
 */
import type { ElementsHeadRow } from '../../contracts/rows';
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
    lifecycleStatus: null,
    lifecycleExposed: null,
    capabilities: [],
    businessOwner: null,
    signals: [],
    missingInputs: [],
    ...overrides,
  };
}
