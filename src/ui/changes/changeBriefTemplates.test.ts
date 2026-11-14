import { describe, expect, it } from 'vitest';
import { MAX_CHANGE_BRIEF_CHARS } from '../../contracts/capture';
import { CHANGE_BRIEF_TEMPLATES, missingBriefSlots, renderBrief, renderBriefText } from './changeBriefTemplates';

const replace = CHANGE_BRIEF_TEMPLATES.find((t) => t.id === 'replace-system');
if (!replace) throw new Error('replace-system template missing');

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
    expect(renderBriefText(replace.title, replace.slots, {})).toBe('Replace [System being replaced] with [New system]');
    expect(renderBrief(replace, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: 'NextCRM' } })).toBe(
      'Introduce NextCRM as a planned system that replaces Legacy CRM. Set the lifecycle status of Legacy CRM to retiring.',
    );
  });

  it('asks for the old system to be retiring, and adds its planned end only when a date is given', () => {
    const base = { oldSystem: { name: 'MPRS' }, newSystem: { name: 'MPRS 2' } };
    expect(renderBrief(replace, base)).toContain('Set the lifecycle status of MPRS to retiring.');
    expect(renderBrief(replace, base)).not.toContain('planned end');
    expect(renderBrief(replace, { ...base, endDate: { name: '2027-03-31' } })).toBe(
      'Introduce MPRS 2 as a planned system that replaces MPRS. Set the lifecycle status of MPRS to retiring. The planned end of MPRS is 2027-03-31.',
    );
  });

  it('adds a go-live sentence to a new system only when a date is given', () => {
    const introduce = CHANGE_BRIEF_TEMPLATES.find((t) => t.id === 'introduce-system');
    if (!introduce) throw new Error('introduce-system template missing');
    const base = { newSystem: { name: 'NextCRM' }, capability: { name: 'Onboarding' } };
    expect(renderBrief(introduce, base)).toBe('Introduce NextCRM as a planned system that supports Onboarding.');
    expect(renderBrief(introduce, { ...base, goLive: { name: '2027-06-01' } })).toBe('Introduce NextCRM as a planned system that supports Onboarding. NextCRM goes live on 2027-06-01.');
  });

  it('has no pill that needs a removal to be complete', () => {
    expect(CHANGE_BRIEF_TEMPLATES.map((t) => t.id)).not.toContain('move-capability');
    expect(CHANGE_BRIEF_TEMPLATES.map((t) => t.pill).join(' ').toLowerCase()).not.toMatch(/move|retire|remove/);
  });

  it('lists the blanks still to fill and treats whitespace as empty', () => {
    expect(missingBriefSlots(replace, {})).toEqual(['System being replaced', 'New system']);
    expect(missingBriefSlots(replace, { oldSystem: { name: 'A' }, newSystem: { name: 'B' } })).toEqual([]);
    expect(missingBriefSlots(replace, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: '  ' } })).toEqual(['New system']);
    expect(missingBriefSlots(replace, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: 'NextCRM' } })).toEqual([]);
  });
});
