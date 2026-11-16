import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { hasReachedPlannedEnd, supportsEdgesInForce, systemsExposedByLifecycle } from './fitAndExposure';

function el(id: string, attributes: Record<string, string> = {}, parentId: string | null = null, type: 'system' | 'container' = 'system'): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parentId, attributes, exists_delta_id: `d-${id}` };
}
function supports(id: string, from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: 'supports', from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

const NOW = new Date('2027-01-01T00:00:00Z');

describe('supportsEdgesInForce', () => {
  const old = el('old', { plannedEnd: '2026-12-31' });
  const replacement = el('new');
  const byId = new Map([old, replacement].map((e) => [e.element_id, e]));

  it('keeps both links before the old system\'s planned end (a migration in progress)', () => {
    const edges = [supports('r1', 'old', 'cap'), supports('r2', 'new', 'cap')];
    expect(supportsEdgesInForce(edges, byId, new Date('2026-06-01T00:00:00Z')).map((e) => e.relationship_id)).toEqual(['r1', 'r2']);
  });

  it('drops the old system\'s link once its planned end has been reached, keeping the replacement\'s', () => {
    const edges = [supports('r1', 'old', 'cap'), supports('r2', 'new', 'cap')];
    expect(supportsEdgesInForce(edges, byId, NOW).map((e) => e.relationship_id)).toEqual(['r2']);
  });

  it('keeps an edge whose supporter is unknown, and never treats a missing date as ended', () => {
    expect(supportsEdgesInForce([supports('r3', 'ghost', 'cap')], byId, NOW)).toHaveLength(1);
    expect(hasReachedPlannedEnd(replacement, byId, NOW)).toBe(false);
  });

  it('a module goes with its platform', () => {
    const platform = el('p', { plannedEnd: '2026-01-01' });
    const module = el('m', {}, 'p', 'container');
    const map = new Map([platform, module].map((e) => [e.element_id, e]));
    expect(hasReachedPlannedEnd(module, map, NOW)).toBe(true);
  });

  it('a replaced system no longer reads as exposed even though it keeps its link', () => {
    expect(systemsExposedByLifecycle([old], NOW)).toBe(true);
    expect(systemsExposedByLifecycle([old], NOW, new Set(['old']))).toBe(false);
  });
});
