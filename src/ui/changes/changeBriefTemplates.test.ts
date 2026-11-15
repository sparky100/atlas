import { describe, expect, it } from 'vitest';
import { MAX_CHANGE_BRIEF_CHARS } from '../../contracts/capture';
import { CHANGE_BRIEF_TEMPLATES, missingBriefSlots, renderBrief, renderBriefText, type ChangeBriefTemplate } from './changeBriefTemplates';

/** A template with an optional blank and a text blank, to cover the blank-filling rules the live pills no longer use. */
const sample: ChangeBriefTemplate = {
  id: 'sample',
  pill: 'Sample',
  title: 'Swap {oldSystem} for {newSystem}',
  brief: 'Introduce {newSystem} to replace {oldSystem}.',
  briefExtras: [{ slot: 'endDate', text: 'The planned end of {oldSystem} is {endDate}.' }],
  slots: [
    { key: 'oldSystem', label: 'System being replaced', kind: 'system' },
    { key: 'newSystem', label: 'New system', kind: 'text' },
    { key: 'endDate', label: 'Old system ends on (optional)', kind: 'date', optional: true },
  ],
};

describe('change brief templates', () => {
  it('has unique ids and pill labels', () => {
    expect(new Set(CHANGE_BRIEF_TEMPLATES.map((t) => t.id)).size).toBe(CHANGE_BRIEF_TEMPLATES.length);
    expect(new Set(CHANGE_BRIEF_TEMPLATES.map((t) => t.pill)).size).toBe(CHANGE_BRIEF_TEMPLATES.length);
  });

  it('only uses blanks that are declared as slots, in both title and brief', () => {
    for (const template of CHANGE_BRIEF_TEMPLATES) {
      const keys = new Set(template.slots.map((s) => s.key));
      for (const text of [template.title, template.brief]) {
        for (const match of text.matchAll(/\{(\w+)\}/g)) expect(keys.has(match[1] ?? '')).toBe(true);
      }
      const wording = [template.brief, ...(template.briefExtras ?? []).map((e) => e.text)].join(' ');
      for (const slot of template.slots) expect(wording).toContain(`{${slot.key}}`);
      for (const extra of template.briefExtras ?? []) expect(template.slots.find((slot) => slot.key === extra.slot)?.optional).toBe(true);
    }
  });

  it('never asks for removals or deletions the drafting prompt does not make', () => {
    for (const template of CHANGE_BRIEF_TEMPLATES) {
      expect(`${template.pill} ${template.brief} ${(template.briefExtras ?? []).map((e) => e.text).join(' ')}`.toLowerCase()).not.toMatch(/remove|decommission|delete/);
    }
  });

  it('keeps every unfilled brief well inside the brief size limit', () => {
    for (const template of CHANGE_BRIEF_TEMPLATES) {
      expect(renderBriefText(template.brief, template.slots, {}).length).toBeLessThan(MAX_CHANGE_BRIEF_CHARS / 10);
    }
  });

  it('shows unfilled blanks as bracketed labels and fills chosen ones', () => {
    expect(renderBriefText(sample.title, sample.slots, {})).toBe('Swap [System being replaced] for [New system]');
    expect(renderBrief(sample, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: 'NextCRM' } })).toBe('Introduce NextCRM to replace Legacy CRM.');
  });

  it('adds an optional sentence only when its blank is filled', () => {
    const base = { oldSystem: { name: 'MPRS' }, newSystem: { name: 'MPRS 2' } };
    expect(renderBrief(sample, base)).not.toContain('planned end');
    expect(renderBrief(sample, { ...base, endDate: { name: '2027-03-31' } })).toBe('Introduce MPRS 2 to replace MPRS. The planned end of MPRS is 2027-03-31.');
  });

  it('leaves the standard changes to the guided forms, not AI pills', () => {
    const ids = CHANGE_BRIEF_TEMPLATES.map((t) => t.id);
    expect(ids).not.toContain('replace-system');
    expect(ids).not.toContain('introduce-system');
    expect(ids).not.toContain('plan-end');
  });

  it('has no pill that needs a removal to be complete', () => {
    expect(CHANGE_BRIEF_TEMPLATES.map((t) => t.id)).not.toContain('move-capability');
    expect(CHANGE_BRIEF_TEMPLATES.map((t) => t.pill).join(' ').toLowerCase()).not.toMatch(/move|retire|remove/);
  });

  it('lists the blanks still to fill and treats whitespace as empty', () => {
    expect(missingBriefSlots(sample, {})).toEqual(['System being replaced', 'New system']);
    expect(missingBriefSlots(sample, { oldSystem: { name: 'A' }, newSystem: { name: 'B' } })).toEqual([]);
    expect(missingBriefSlots(sample, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: '  ' } })).toEqual(['New system']);
  });
});
