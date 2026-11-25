import { describe, expect, it } from 'vitest';
import { parseDecisionPrefillFromSearchParams, prefillFromCapabilityNoSupportersFinding, prefillFromCriticalSupportEndFinding } from '../decisions/decisionPrefill';
import { scopeHasCapability } from './projectModel';
import { projectFormFromPrefill, startProjectFromElementHref } from './projectPrefill';

describe('projectFormFromPrefill', () => {
  it('uses the project voice, not the decision voice, and keeps the elements as scope', () => {
    const form = projectFormFromPrefill(prefillFromCriticalSupportEndFinding({ id: 'pm', name: 'SAP PM' }));
    expect(form.title).toBe('Replace SAP PM');
    expect(form.purpose).toContain('Work out the replacement options');
    expect(form.purpose).not.toContain('a decision is needed');
    expect(form.sourceFindingKey).toBe('critical-support-end');
    expect(form.scope).toEqual([{ elementId: 'pm', name: 'SAP PM', elementType: 'system' }]);
  });

  it('carries a prefilled capability through as scope with its type and a project-shaped purpose', () => {
    const form = projectFormFromPrefill(prefillFromCapabilityNoSupportersFinding({ id: 'cap-2', name: 'Adult Social Care' }));
    expect(form.title).toBe('Meet Adult Social Care');
    expect(form.purpose).toContain('No system is recorded as supporting Adult Social Care');
    expect(form.scope).toEqual([{ elementId: 'cap-2', name: 'Adult Social Care', elementType: 'capability' }]);
    expect(scopeHasCapability(form.scope)).toBe(true);
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

  it('carries the element type and a project-shaped default when the element page knows it', () => {
    const href = startProjectFromElementHref('/o/x/m/y/projects', { id: 'cap-1', name: 'Housing Repairs', type: 'capability' });
    const prefill = parseDecisionPrefillFromSearchParams(new URLSearchParams(href.split('?')[1]));
    expect(prefill).not.toBeNull();
    if (!prefill) return;
    const form = projectFormFromPrefill(prefill);
    expect(form.title).toBe('Meet Housing Repairs');
    expect(form.purpose).toContain('Work out what Housing Repairs needs');
    expect(form.scope).toEqual([{ elementId: 'cap-1', name: 'Housing Repairs', elementType: 'capability' }]);
    expect(scopeHasCapability(form.scope)).toBe(true);
  });

  it('gives a system start a decision-of-its-future title and a keep/extend/replace purpose', () => {
    const href = startProjectFromElementHref('/o/x/m/y/projects', { id: 'sys-1', name: 'Legacy CRM', type: 'system' });
    const prefill = parseDecisionPrefillFromSearchParams(new URLSearchParams(href.split('?')[1]));
    expect(prefill).not.toBeNull();
    if (!prefill) return;
    const form = projectFormFromPrefill(prefill);
    expect(form.title).toBe('Decide the future of Legacy CRM');
    expect(form.purpose).toContain('keep, extend, replace or retire Legacy CRM');
  });
});
