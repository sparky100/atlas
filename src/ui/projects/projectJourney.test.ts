import { describe, expect, it } from 'vitest';
import { buildProjectJourney, type JourneyInput } from './projectJourney';

const base: JourneyInput = { purpose: 'Cut the time to issue a connection quote.', capabilities: [{ id: 'c1', name: 'Connect a new customer', supporters: ['Quote Tool'] }], changeCount: 1, decisionCount: 1, chosenCount: 1 };

describe('buildProjectJourney (plan B1)', () => {
  it('reads Done on every step for a project that has all four', () => {
    expect(buildProjectJourney(base).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('marks the first step not done as Next and the rest after it Not started', () => {
    const steps = buildProjectJourney({ ...base, purpose: '  ', capabilities: [], changeCount: 0, decisionCount: 0, chosenCount: 0 });
    expect(steps.map((s) => s.state)).toEqual(['next', 'todo', 'todo', 'todo']);
  });

  it('says plainly that a capability nothing supports needs a buy or build option', () => {
    const steps = buildProjectJourney({ ...base, capabilities: [{ id: 'c1', name: 'Connect a new customer', supporters: [] }] });
    expect(steps[2]?.detail).toBe('Nothing we run supports Connect a new customer — a buy or build option is needed.');
  });

  it('splits supported from unsupported capabilities', () => {
    const steps = buildProjectJourney({ ...base, capabilities: [{ id: 'a', name: 'A', supporters: ['X'] }, { id: 'b', name: 'B', supporters: [] }] });
    expect(steps[2]?.detail).toBe('1 already supported by something we run; nothing supports B.');
  });

  it('counts decisions and says when none is chosen', () => {
    expect(buildProjectJourney({ ...base, decisionCount: 2, chosenCount: 0 })[3]?.detail).toBe('2 decisions open, none chosen yet.');
    expect(buildProjectJourney({ ...base, decisionCount: 2, chosenCount: 1 })[3]?.detail).toBe('1 of 2 decisions chosen.');
    expect(buildProjectJourney({ ...base, decisionCount: 0, chosenCount: 0 })[3]?.detail).toBe('No decision started yet.');
  });

  it('shortens a long purpose to one line', () => {
    const steps = buildProjectJourney({ ...base, purpose: 'x'.repeat(200) });
    expect(steps[0]?.detail.length).toBeLessThanOrEqual(90);
    expect(steps[0]?.detail.endsWith('…')).toBe(true);
  });
});
