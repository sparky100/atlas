import { describe, expect, it } from 'vitest';
import { bandAction, capabilityProblems, purposeFromProblems, type CapabilitySupporter } from './capabilityProblems';

const sys = (over: Partial<CapabilitySupporter> = {}): CapabilitySupporter => ({ systemId: 's1', name: 'Quote Tool', fit: 'good', note: '', ...over });

describe('capabilityProblems', () => {
  it('says nothing when nothing is wrong', () => {
    expect(capabilityProblems({ supporters: [sys()], missingFactsText: '' })).toEqual([]);
  });

  it('a poor fit with a reason carries the reason; without one it says none is recorded', () => {
    const [withReason] = capabilityProblems({ supporters: [sys({ fit: 'poor', note: ' Quotes are keyed by hand. ' })], missingFactsText: '' });
    expect(withReason).toMatchObject({ kind: 'poor-fit', text: 'Quote Tool is a poor fit.', reason: 'Quotes are keyed by hand.', systemId: 's1' });
    const [without] = capabilityProblems({ supporters: [sys({ fit: 'poor' })], missingFactsText: '' });
    expect(without).toMatchObject({ text: 'Quote Tool is rated a poor fit, but no reason is recorded. Add it under Relationships.', reason: null });
  });

  it('adequate is not a problem', () => {
    expect(capabilityProblems({ supporters: [sys({ fit: 'adequate' })], missingFactsText: '' })).toEqual([]);
  });

  it('no supporter, then unrated fit, then missing facts, after poor fits', () => {
    expect(capabilityProblems({ supporters: [], missingFactsText: 'owner' }).map((p) => p.kind)).toEqual(['no-supporter', 'missing-facts']);
    expect(capabilityProblems({ supporters: [sys({ fit: null }), sys({ systemId: 's2', name: 'B', fit: 'poor' })], missingFactsText: 'owner' }).map((p) => p.kind)).toEqual(['poor-fit', 'fit-unrated', 'missing-facts']);
  });

  it('never says replace or retire', () => {
    const text = capabilityProblems({ supporters: [sys({ fit: 'poor' })], missingFactsText: 'owner' }).map((p) => p.text).join(' ');
    expect(text).not.toMatch(/replace|retire/i);
  });
});

describe('bandAction', () => {
  it('is a project for a real problem, a fill-in for missing facts only, none for nothing', () => {
    expect(bandAction([])).toBeNull();
    expect(bandAction(capabilityProblems({ supporters: [sys()], missingFactsText: 'owner' }))).toBe('fill-in');
    expect(bandAction(capabilityProblems({ supporters: [], missingFactsText: '' }))).toBe('project');
  });
});

describe('purposeFromProblems', () => {
  it('starts the purpose from each written reason, with its source', () => {
    const problems = capabilityProblems({
      supporters: [
        { systemId: 'a', name: 'Quote Tool', fit: 'poor', note: 'Quotes are keyed by hand.' },
        { systemId: 'b', name: 'Mailer', fit: 'poor', note: '' },
      ],
      missingFactsText: '',
    });
    expect(purposeFromProblems(problems)).toBe('Quote Tool: Quotes are keyed by hand. (From the fit note on Quote Tool.)');
  });
  it('is empty when nobody wrote a reason', () => {
    expect(purposeFromProblems(capabilityProblems({ supporters: [{ systemId: 'a', name: 'Quote Tool', fit: 'poor', note: '' }], missingFactsText: '' }))).toBe('');
  });
});
