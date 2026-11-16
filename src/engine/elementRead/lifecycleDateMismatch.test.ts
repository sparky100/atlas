import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { describeLifecycleMismatch, findLifecycleDateMismatches, formatPlainDate, lifecycleFixLabel } from './lifecycleDateMismatch';

const NOW = new Date('2026-11-16T10:00:00Z');

function el(id: string, attributes: Record<string, string>, over: Partial<ElementsHeadRow> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes, ...over } as unknown as ElementsHeadRow;
}

describe('findLifecycleDateMismatches', () => {
  it('flags active with a future introduced date and suggests planned', () => {
    const [m] = findLifecycleDateMismatches([el('a', { lifecycleStatus: 'active', introduced: '2027-01-01' })], NOW);
    expect(m).toMatchObject({ kind: 'active-not-yet-introduced', suggested: 'planned', date: '2027-01-01' });
  });

  it('flags planned whose introduced date has come, today included, and suggests active', () => {
    const found = findLifecycleDateMismatches([el('a', { lifecycleStatus: 'planned', introduced: '2026-11-16' }), el('b', { lifecycleStatus: 'planned', introduced: '2026-01-01' })], NOW);
    expect(found.map((m) => [m.kind, m.suggested])).toEqual([['planned-already-introduced', 'active'], ['planned-already-introduced', 'active']]);
  });

  it('flags active past its planned end and suggests retired', () => {
    const [m] = findLifecycleDateMismatches([el('a', { lifecycleStatus: 'active', plannedEnd: '2026-06-30' })], NOW);
    expect(m).toMatchObject({ kind: 'active-past-end', suggested: 'retired' });
  });

  it('leaves consistent elements alone', () => {
    const found = findLifecycleDateMismatches(
      [
        el('planned-future', { lifecycleStatus: 'planned', introduced: '2027-01-01' }),
        el('active-past', { lifecycleStatus: 'active', introduced: '2020-01-01', plannedEnd: '2030-01-01' }),
        el('no-dates', { lifecycleStatus: 'active' }),
        el('retiring', { lifecycleStatus: 'retiring', plannedEnd: '2026-01-01' }),
        el('retired', { lifecycleStatus: 'retired', plannedEnd: '2026-01-01' }),
        el('bad-date', { lifecycleStatus: 'active', introduced: 'soon' }),
        el('capability', { lifecycleStatus: 'active', introduced: '2027-01-01' }, { element_type: 'capability' }),
      ],
      NOW,
    );
    expect(found).toEqual([]);
  });

  it('a module with no status of its own reads its platform’s', () => {
    const platform = el('p', { lifecycleStatus: 'active' });
    const module = el('m', { introduced: '2027-03-01' }, { element_type: 'container', parent_id: 'p' });
    expect(findLifecycleDateMismatches([platform, module], NOW).map((m) => m.element.element_id)).toEqual(['m']);
  });
});

describe('wording', () => {
  it('says what disagrees in plain English', () => {
    expect(formatPlainDate('2027-01-01')).toBe('1 Jan 2027');
    expect(describeLifecycleMismatch({ kind: 'active-not-yet-introduced', date: '2027-01-01' })).toBe('Marked active, but not introduced until 1 Jan 2027');
    expect(describeLifecycleMismatch({ kind: 'planned-already-introduced', date: '2026-01-05' })).toBe('Marked planned, but introduced on 5 Jan 2026');
    expect(describeLifecycleMismatch({ kind: 'active-past-end', date: '2026-06-30' })).toBe('Marked active, but its planned end was 30 Jun 2026');
    expect(lifecycleFixLabel('planned')).toBe('Set to planned');
  });
});
