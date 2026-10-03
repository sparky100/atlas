import { describe, expect, it } from 'vitest';
import {
  decisionPrefillToSearchParams,
  parseDecisionPrefillFromSearchParams,
  prefillFromCapabilityNoSupportersFinding,
  prefillFromCriticalExposedFinding,
  prefillFromCriticalSupportEndFinding,
  prefillFromWeakFitCapabilities,
  prefillFromWeakCapability,
} from './decisionPrefill';

describe('decisionPrefill', () => {
  it('builds a critical-support-end prefill naming the system in both title and statement', () => {
    const prefill = prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' });
    expect(prefill.title).toContain('SAP PM');
    expect(prefill.statement).toContain('SAP PM');
    expect(prefill.sourceFindingKey).toBe('critical-support-end');
    expect(prefill.linkedElements).toEqual([{ id: 'sys-1', name: 'SAP PM' }]);
  });

  it('builds a weak-capability prefill naming the capability and its own tone label', () => {
    const prefill = prefillFromWeakCapability({ id: 'cap-1', name: 'Finance' }, 'lifecycle exposure');
    expect(prefill.title).toContain('Finance');
    expect(prefill.statement).toContain('Finance');
    expect(prefill.statement).toContain('lifecycle exposure');
    expect(prefill.sourceFindingKey).toBe('weak-capability');
  });

  it('builds a critical-exposed prefill naming the system', () => {
    const prefill = prefillFromCriticalExposedFinding({ id: 'sys-2', name: 'Legacy Case System' });
    expect(prefill.title).toContain('Legacy Case System');
    expect(prefill.statement).toContain('Legacy Case System');
    expect(prefill.sourceFindingKey).toBe('critical-exposed');
    expect(prefill.linkedElements).toEqual([{ id: 'sys-2', name: 'Legacy Case System' }]);
  });

  it('builds a capability-no-supporters prefill naming the capability', () => {
    const prefill = prefillFromCapabilityNoSupportersFinding({ id: 'cap-2', name: 'Adult Social Care' });
    expect(prefill.title).toContain('Adult Social Care');
    expect(prefill.statement).toContain('Adult Social Care');
    expect(prefill.statement).toContain('no known supporting system');
    expect(prefill.sourceFindingKey).toBe('capability-no-supporters');
    expect(prefill.linkedElements).toEqual([{ id: 'cap-2', name: 'Adult Social Care' }]);
  });

  describe('prefillFromWeakFitCapabilities (F6.1: fit visible to directors)', () => {
    it('names the single capability and the tile it lives under', () => {
      const prefill = prefillFromWeakFitCapabilities('Claims', [{ id: 'cap-1', name: 'Claims Intake' }]);
      expect(prefill.title).toContain('Claims');
      expect(prefill.statement).toContain('Claims Intake');
      expect(prefill.statement).toContain('Claims');
      expect(prefill.sourceFindingKey).toBe('poor-fit-director');
      expect(prefill.linkedElements).toEqual([{ id: 'cap-1', name: 'Claims Intake' }]);
    });

    it('links every poor-fit capability, not just the level-1 tile, for a mixed subtree', () => {
      const capabilities = [
        { id: 'cap-1', name: 'Claims Intake' },
        { id: 'cap-2', name: 'Claims Triage' },
      ];
      const prefill = prefillFromWeakFitCapabilities('Claims', capabilities);
      expect(prefill.statement).toContain('2 capabilities');
      expect(prefill.statement).toContain('Claims Intake');
      expect(prefill.statement).toContain('Claims Triage');
      expect(prefill.linkedElements).toEqual(capabilities);
    });
  });

  it('round-trips through URLSearchParams unchanged', () => {
    const prefill = prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' });
    const params = decisionPrefillToSearchParams(prefill);
    const parsed = parseDecisionPrefillFromSearchParams(params);
    expect(parsed).toEqual(prefill);
  });

  it('round-trips a multi-element prefill (order preserved) through URLSearchParams', () => {
    const prefill = prefillFromWeakFitCapabilities('Claims', [
      { id: 'cap-1', name: 'Claims Intake' },
      { id: 'cap-2', name: 'Claims Triage' },
    ]);
    const params = decisionPrefillToSearchParams(prefill);
    const parsed = parseDecisionPrefillFromSearchParams(params);
    expect(parsed).toEqual(prefill);
  });

  it('round-trips a title/statement containing "&" and other URL-hostile characters', () => {
    const prefill = prefillFromWeakCapability({ id: 'cap-1', name: 'Risk & Compliance' }, 'no known supporters');
    const params = decisionPrefillToSearchParams(prefill);
    const parsed = parseDecisionPrefillFromSearchParams(new URLSearchParams(params.toString()));
    expect(parsed).toEqual(prefill);
  });

  it('returns null when any expected param is missing (a bare /decisions link, or a stripped param)', () => {
    expect(parseDecisionPrefillFromSearchParams(new URLSearchParams())).toBeNull();
    const partial = decisionPrefillToSearchParams(prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' }));
    partial.delete('startElementId');
    expect(parseDecisionPrefillFromSearchParams(partial)).toBeNull();
  });

  it('returns null when the id and name lists come out different lengths (a hand-edited or truncated URL)', () => {
    const params = decisionPrefillToSearchParams(prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' }));
    params.append('startElementId', 'sys-2');
    expect(parseDecisionPrefillFromSearchParams(params)).toBeNull();
  });
});
