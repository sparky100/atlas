import { describe, expect, it } from 'vitest';
import { decisionPrefillToSearchParams, parseDecisionPrefillFromSearchParams, prefillFromCriticalSupportEndFinding, prefillFromWeakCapability } from './decisionPrefill';

describe('decisionPrefill', () => {
  it('builds a critical-support-end prefill naming the system in both title and statement', () => {
    const prefill = prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' });
    expect(prefill.title).toContain('SAP PM');
    expect(prefill.statement).toContain('SAP PM');
    expect(prefill.sourceFindingKey).toBe('critical-support-end');
    expect(prefill.linkedElementId).toBe('sys-1');
    expect(prefill.linkedElementName).toBe('SAP PM');
  });

  it('builds a weak-capability prefill naming the capability and its own tone label', () => {
    const prefill = prefillFromWeakCapability({ id: 'cap-1', name: 'Finance' }, 'lifecycle exposure');
    expect(prefill.title).toContain('Finance');
    expect(prefill.statement).toContain('Finance');
    expect(prefill.statement).toContain('lifecycle exposure');
    expect(prefill.sourceFindingKey).toBe('weak-capability');
  });

  it('round-trips through URLSearchParams unchanged', () => {
    const prefill = prefillFromCriticalSupportEndFinding({ id: 'sys-1', name: 'SAP PM' });
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
});
