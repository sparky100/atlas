import { describe, expect, it } from 'vitest';
import { fakeElement, fakeRow, fakeSupportsEdge } from '../portfolio/portfolioTestFixtures';
import type { PortfolioCapabilityLink } from '../portfolio/usePortfolio';
import { completenessLabel, completenessOf, firstWalkableKind, gapElementCount, gapItemQuestion, gapItems, gapSummary, missingFactsText } from './gaps';

function link(fromId: string, capId: string, fit: PortfolioCapabilityLink['fit']): PortfolioCapabilityLink {
  return { capabilityId: capId, capabilityName: `Cap ${capId}`, fit, relationship: fakeSupportsEdge(fromId, capId), otherSupporters: [] };
}

const system = (id: string, overrides: Parameters<typeof fakeRow>[0] = {}) => fakeRow({ element: fakeElement(id), name: id, topLevelSystemId: id, ...overrides });
const module_ = (id: string, overrides: Parameters<typeof fakeRow>[0] = {}) => fakeRow({ element: fakeElement(id, 'container'), name: `Platform · ${id}`, ...overrides });

describe('gapItems', () => {
  it('run cost covers systems and modules, each element\'s own value', () => {
    const rows = [system('a'), system('b', { cost: 'under_50k' }), module_('m')];
    expect(gapItems('run-cost', rows).map((i) => i.key)).toEqual(['a', 'm']);
  });

  it('criticality and disposition are systems only — a module\'s value is an optional override', () => {
    const rows = [system('a'), system('b', { criticality: 'high', disposition: 'invest' }), module_('m')];
    expect(gapItems('criticality', rows).map((i) => i.key)).toEqual(['a']);
    expect(gapItems('disposition', rows).map((i) => i.key)).toEqual(['a']);
  });

  it('fit is one item per unrated supports edge, counted by element', () => {
    const rows = [system('a', { capabilities: [link('a', 'c1', null), link('a', 'c2', null), link('a', 'c3', 'good')] }), system('b', { capabilities: [link('b', 'c1', 'poor')] })];
    const items = gapItems('fit', rows);
    expect(items.map((i) => i.key)).toEqual(['r-a-c1', 'r-a-c2']);
    expect(gapElementCount(items)).toBe(1);
    expect(gapSummary('fit', items)).toBe('1 system has no fit rating (2 capability links)');
    const [first] = items;
    expect(first && gapItemQuestion(first)).toBe('How well does a fit Cap c1?');
  });

  it('owner is systems with no owns edge of any role', () => {
    const owns = { ...fakeSupportsEdge('actor', 'b'), relationship_type: 'owns' as const };
    const rows = [system('a'), system('b', { ownsEdges: [owns] }), module_('m')];
    expect(gapItems('owner', rows).map((i) => i.key)).toEqual(['a']);
    expect(gapSummary('owner', gapItems('owner', rows))).toBe('1 system has no owner');
  });

  it('never lists a retired element', () => {
    const rows = [system('a', { lifecycleStatus: 'retired' }), system('b', { lifecycleStatus: 'retiring' })];
    expect(gapItems('criticality', rows).map((i) => i.key)).toEqual(['b']);
  });
});

describe('completenessOf', () => {
  const cases: [string, ReturnType<typeof system>][] = [
    ['empty system', system('a')],
    ['full system', system('b', { cost: 'under_50k', criticality: 'high', disposition: 'invest', ownsEdges: [{ ...fakeSupportsEdge('actor', 'b'), relationship_type: 'owns' as const }], capabilities: [link('b', 'c1', 'good')] })],
    ['two links one unrated', system('c', { cost: 'under_50k', capabilities: [link('c', 'c1', null), link('c', 'c2', 'good')] })],
    ['module', module_('m')],
    ['retired system', system('r', { lifecycleStatus: 'retired' })],
  ];

  it.each(cases)('agrees with gapItems: %s', (_name, row) => {
    const c = completenessOf(row);
    const gapCount = (['fit', 'owner', 'run-cost', 'criticality', 'disposition'] as const).reduce((n, k) => n + gapItems(k, [row]).length, 0);
    const linkGap = row.element.element_type === 'system' && c.total > 0 && row.capabilities.length === 0 ? 1 : 0;
    expect(c.missing.length).toBe(gapCount + linkGap);
    expect(c.recorded).toBe(c.total - c.missing.length);
    expect(c.recorded).toBeLessThanOrEqual(c.total);
  });

  it('counts totals per element type', () => {
    expect(completenessOf(system('a'))).toMatchObject({ recorded: 0, total: 5 });
    expect(completenessOf(module_('m'))).toMatchObject({ recorded: 0, total: 1 });
    expect(completenessOf(system('r', { lifecycleStatus: 'retired' }))).toEqual({ recorded: 0, total: 0, missing: [] });
    expect(completenessOf(system('c', { capabilities: [link('c', 'c1', null), link('c', 'c2', 'good')] }))).toMatchObject({ total: 7 });
  });

  it('recording a fact never lowers the fraction', () => {
    const before = completenessOf(system('a'));
    const after = completenessOf(system('a', { cost: 'under_50k' }));
    expect(after.recorded).toBeGreaterThan(before.recorded);
    expect(after.total).toBe(before.total);
  });

  it('words', () => {
    const c = completenessOf(system('a', { capabilities: [link('a', 'c1', null), link('a', 'c2', null)] }));
    expect(completenessLabel(c)).toBe('1 of 7 recorded');
    expect(missingFactsText(c)).toBe('owner, run cost, criticality, planned action, fit rating (2)');
    expect(firstWalkableKind(c)).toBe('fit');
  });
});
