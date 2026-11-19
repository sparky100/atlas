import { describe, expect, it } from 'vitest';
import { parseDesignerOptions } from './designerOptions';

const good = { options: [{ title: 'Configure what we run', summary: 'Use the quoting module as is.', toWeigh: 'Fit.' }, { title: 'Replace with a product', summary: 'Buy one.', toWeigh: '' }], gaps: ['No owner recorded'], stayNote: 'Quotes stay slow.' };

describe('parseDesignerOptions', () => {
  it('accepts a complete answer, bare or in a code fence', () => {
    for (const answer of [JSON.stringify(good), `Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``]) {
      const r = parseDesignerOptions(answer);
      expect(r.problems).toEqual([]);
      expect(r.options.map((o) => o.title)).toEqual(['Configure what we run', 'Replace with a product']);
      expect(r.gaps).toEqual(['No owner recorded']);
      expect(r.stayNote).toBe('Quotes stay slow.');
    }
  });
  it('says so when the answer is not usable at all', () => {
    expect(parseDesignerOptions('Sorry, I cannot do that.').problems).toHaveLength(1);
    expect(parseDesignerOptions('{ not json').options).toEqual([]);
  });
  it('drops incomplete, duplicate and baseline options and says it is incomplete', () => {
    const r = parseDesignerOptions(JSON.stringify({ options: [{ title: 'Stay as we are', summary: 'x' }, { title: 'Keep', summary: '' }, { title: 'Build', summary: 'Build it.' }, { title: 'build', summary: 'again' }] }));
    expect(r.options.map((o) => o.title)).toEqual(['Build']);
    expect(r.problems.join(' ')).toMatch(/left out/);
    expect(r.problems.join(' ')).toMatch(/fewer options/);
  });
  it('caps the list at six and never marks a short list complete', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `Option ${String(i)}`, summary: 's' }));
    expect(parseDesignerOptions(JSON.stringify({ options: many })).options).toHaveLength(6);
    expect(parseDesignerOptions(JSON.stringify({ options: [many[0]] })).problems.length).toBeGreaterThan(0);
  });
});
