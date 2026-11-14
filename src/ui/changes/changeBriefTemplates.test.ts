import { describe, expect, it } from 'vitest';
import { MAX_CHANGE_BRIEF_CHARS } from '../../contracts/capture';
import { CHANGE_BRIEF_TEMPLATES, missingBriefSlots, renderBriefText } from './changeBriefTemplates';

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
      for (const slot of template.slots) expect(template.brief).toContain(`{${slot.key}}`);
    }
  });

  it('never promises retirements or removals the drafting prompt does not make', () => {
    for (const template of CHANGE_BRIEF_TEMPLATES) {
      expect(`${template.pill} ${template.brief}`.toLowerCase()).not.toMatch(/retire|remove|decommission/);
    }
  });

  it('keeps every unfilled brief well inside the brief size limit', () => {
    for (const template of CHANGE_BRIEF_TEMPLATES) {
      expect(renderBriefText(template.brief, template.slots, {}).length).toBeLessThan(MAX_CHANGE_BRIEF_CHARS / 10);
    }
  });

  it('shows unfilled blanks as bracketed labels and fills chosen ones', () => {
    expect(renderBriefText(replace.brief, replace.slots, {})).toBe('Introduce [New system] to replace [System being replaced].');
    expect(renderBriefText(replace.brief, replace.slots, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: 'NextCRM' } })).toBe('Introduce NextCRM to replace Legacy CRM.');
  });

  it('lists the blanks still to fill and treats whitespace as empty', () => {
    expect(missingBriefSlots(replace, {})).toEqual(['System being replaced', 'New system']);
    expect(missingBriefSlots(replace, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: '  ' } })).toEqual(['New system']);
    expect(missingBriefSlots(replace, { oldSystem: { name: 'Legacy CRM' }, newSystem: { name: 'NextCRM' } })).toEqual([]);
  });
});
