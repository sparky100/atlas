import { describe, expect, it } from 'vitest';
import { fakeElement, fakeRow, fakeSupportsEdge } from '../portfolio/portfolioTestFixtures';
import type { PortfolioCapabilityLink } from '../portfolio/usePortfolio';
import { gapElementCount, gapItemQuestion, gapItems, gapSummary } from './gaps';

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
