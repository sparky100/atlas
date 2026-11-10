import { describe, expect, it } from 'vitest';
import { firstVisitContent, gettingStartedSteps, showGettingStarted } from './gettingStarted';

describe('gettingStartedSteps', () => {
  it('ticks each step from its own count', () => {
    expect(gettingStartedSteps({ capabilities: 2, systems: 0, supportsEdges: 0 }).map((s) => s.done)).toEqual([true, false, false]);
    expect(gettingStartedSteps({ capabilities: 2, systems: 1, supportsEdges: 1 }).map((s) => s.done)).toEqual([true, true, true]);
  });
  it('hides once every step is done', () => {
    expect(showGettingStarted(gettingStartedSteps({ capabilities: 1, systems: 1, supportsEdges: 1 }))).toBe(false);
    expect(showGettingStarted(gettingStartedSteps({ capabilities: 0, systems: 0, supportsEdges: 0 }))).toBe(true);
  });
});

describe('invite step and first visit', () => {
  const counts = { capabilities: 1, systems: 1, supportsEdges: 1 };
  it('offers the invite step only when an invite count is given', () => {
    expect(gettingStartedSteps(counts).map((s) => s.id)).toEqual(['capabilities', 'system', 'link']);
    const withInvite = gettingStartedSteps(counts, 0);
    expect(withInvite.map((s) => s.id)).toContain('invite');
    expect(showGettingStarted(withInvite)).toBe(true);
    expect(showGettingStarted(gettingStartedSteps(counts, 2))).toBe(false);
  });
  it('words the first-visit card per role', () => {
    expect(firstVisitContent('viewer').links.map((l) => l.to)).toEqual(['capability-map', 'landscape']);
    expect(firstVisitContent('contributor').links.map((l) => l.to)).toContain('changes');
    expect(firstVisitContent('owner').links.map((l) => l.to)).toContain('work');
  });
});
