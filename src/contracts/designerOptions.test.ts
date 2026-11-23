import { describe, expect, it } from 'vitest';
import { parseCatalogueProducts, parseDesignerOptions } from './designerOptions';

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
  it('keeps well-formed catalogue refs, drops malformed ones, dedupes and caps at two', () => {
    const ref = { sector: 'electricity_network', version: 2, entryCode: 'crm-x' };
    const r = parseDesignerOptions(JSON.stringify({
      options: [{ title: 'Replace', summary: 'Buy one.', catalogueRefs: [ref, ref, { sector: 'electricity_network', version: 2, entryCode: 'other' }, { sector: '', version: 0, entryCode: 'x' }, { sector: 'electricity_network', version: 2, entryCode: 'third' }] }],
      gaps: [], stayNote: '',
    }));
    expect(r.options[0]?.catalogueRefs).toEqual([ref, { sector: 'electricity_network', version: 2, entryCode: 'other' }]);
    expect(parseDesignerOptions(JSON.stringify({ options: [{ title: 'Keep', summary: 'As is.' }] })).options[0]?.catalogueRefs).toEqual([]);
  });
  it('keeps only well-formed web refs, dedupes and caps at two', () => {
    const ref = { url: 'https://vendor.example/product', title: 'Product page' };
    const r = parseDesignerOptions(JSON.stringify({
      options: [{ title: 'Replace', summary: 'Buy.', webRefs: [ref, ref, { url: 'http://insecure.example/x', title: 'No' }, { url: 'https://vendor.example/other', title: '' }, { url: 'https://vendor.example/third', title: 'Third' }] }],
      gaps: [], stayNote: '',
    }));
    expect(r.options[0]?.webRefs).toEqual([ref, { url: 'https://vendor.example/third', title: 'Third' }]);
    expect(parseDesignerOptions(JSON.stringify({ options: [{ title: 'Keep', summary: 'As is.' }] })).options[0]?.webRefs).toEqual([]);
  });
  it('keeps well-formed catalogue product cards and drops malformed or duplicate ones', () => {
    const ref = { sector: 'electricity_network', version: 2, entryCode: 'crm-x' };
    const card = {
      ref,
      product: 'CRM X',
      vendor: 'Vendor Ltd',
      summary: 'A CRM.',
      capabilityName: 'Complaints',
      howItSupports: 'Records complaints.',
      claims: [{ statement: 'Records complaints.', kind: 'functional', sourceUrl: 'https://vendor.example/crm', sourceDate: '2026-01-01' }],
    };
    expect(parseCatalogueProducts([
      card,
      card,
      { ...card, ref: { sector: '', version: 0, entryCode: '' } },
      { ...card, product: '' },
      { ...card, ref: { sector: 'electricity_network', version: 2, entryCode: 'other' }, product: 'CRM Y', claims: [{ statement: '', sourceUrl: '', sourceDate: '' }] },
    ])).toEqual([card, { ...card, ref: { sector: 'electricity_network', version: 2, entryCode: 'other' }, product: 'CRM Y', claims: [] }]);
  });

  it('keeps a full "what to weigh" up to the larger limit and cuts a longer one at a word boundary', () => {
    const long = 'The catalogue evidence is only the vendor own positioning. '.repeat(8);
    const r = parseDesignerOptions(JSON.stringify({ options: [{ title: 'Replace', summary: 'Buy.', toWeigh: long }], gaps: [], stayNote: '' }));
    expect(r.options[0]?.toWeigh).toBe(long.trim());
    const tooLong = `${'word '.repeat(170)}end`;
    const cut = parseDesignerOptions(JSON.stringify({ options: [{ title: 'Replace', summary: 'Buy.', toWeigh: tooLong }], gaps: [], stayNote: '' })).options[0]?.toWeigh ?? '';
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain('  ');
    expect(cut.length).toBeLessThanOrEqual(801);
  });
});
