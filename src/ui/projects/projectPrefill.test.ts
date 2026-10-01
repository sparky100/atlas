import { describe, expect, it } from 'vitest';
import { parseDecisionPrefillFromSearchParams, prefillFromCriticalSupportEndFinding } from '../decisions/decisionPrefill';
import { projectFormFromPrefill, startProjectFromElementHref } from './projectPrefill';

describe('projectFormFromPrefill', () => {
  it('names the project for the work, keeps the context as purpose and the elements as scope', () => {
    const form = projectFormFromPrefill(prefillFromCriticalSupportEndFinding({ id: 'pm', name: 'SAP PM' }));
    expect(form.title).toBe('Replace SAP PM');
    expect(form.purpose).toContain('SAP PM is critical');
    expect(form.sourceFindingKey).toBe('critical-support-end');
    expect(form.scope).toEqual([{ elementId: 'pm', name: 'SAP PM' }]);
  });
});

describe('startProjectFromElementHref', () => {
  it('round-trips through the shared prefill params with the element as scope and no finding key', () => {
    const href = startProjectFromElementHref('/o/x/m/y/projects', { id: 'cap-1', name: 'Housing Repairs' });
    expect(href.startsWith('/o/x/m/y/projects?')).toBe(true);
    const prefill = parseDecisionPrefillFromSearchParams(new URLSearchParams(href.split('?')[1]));
    expect(prefill).not.toBeNull();
    if (!prefill) return;
    const form = projectFormFromPrefill(prefill);
    expect(form).toEqual({ title: 'Housing Repairs', purpose: '', sourceFindingKey: null, scope: [{ elementId: 'cap-1', name: 'Housing Repairs' }] });
  });
});
