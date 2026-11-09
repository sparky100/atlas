import { describe, expect, it } from 'vitest';
import { gettingStartedSteps, showGettingStarted } from './gettingStarted';

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
