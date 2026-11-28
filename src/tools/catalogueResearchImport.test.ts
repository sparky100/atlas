import { describe, expect, it } from 'vitest';
import { groupResearch, parseResearch, platformsToCreate, researchContent, RESEARCH_PROMPT } from './catalogueResearchImport';

const header = 'Platform\tVendor\tProduct or module\tSummary\tSource link\tQuoted sentence\tKind';
const row = (cells: string[]) => cells.join('\t');

describe('parseResearch', () => {
  it('reads a spreadsheet paste, columns by name in any order', () => {
    const text = ['Vendor\tProduct\tSummary\tSource\tQuote\tPlatform', row(['SAP', 'SAP S/4HANA Asset Management', 'Maintains plant assets.', 'https://www.sap.com/am', 'SAP S/4HANA Asset Management helps you maintain assets.', 'SAP S/4HANA'])].join('\n');
    const { rows, problems } = parseResearch(text);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ vendor: 'SAP', product: 'SAP S/4HANA Asset Management', platform: 'SAP S/4HANA', kind: 'functional', line: 2 });
  });
  it('reads a pasted AI chat table with pipes and a rule line, and bold or quoted cells', () => {
    const text = [
      '| Platform | Vendor | Product or module | Summary | Source link | Quoted sentence | Kind |',
      '|---|---|---|---|---|---|---|',
      '| SAP S/4HANA | SAP | **SAP S/4HANA Finance** | Runs the ledgers. | https://www.sap.com/fin | "SAP S/4HANA Finance runs your financial close." | Functional |',
    ].join('\n');
    const { rows, problems } = parseResearch(text);
    expect(problems).toEqual([]);
    expect(rows[0]?.product).toBe('SAP S/4HANA Finance');
    expect(rows[0]?.sentence).toBe('SAP S/4HANA Finance runs your financial close.');
  });
  it('reads comma-separated rows with quoted commas', () => {
    const text = ['Vendor,Product,Summary,Source,Quote', 'Itron,"Itron MDM, Enterprise",Holds meter data.,https://www.itron.com/mdm,"Itron MDM stores interval data, at scale."'].join('\n');
    expect(parseResearch(text).rows[0]?.product).toBe('Itron MDM, Enterprise');
  });
  it('names the missing column instead of guessing', () => {
    expect(parseResearch('Vendor\tProduct\tSummary\tSource').problems[0]?.text).toContain('"Quoted sentence" is missing');
  });
  it('reports each bad row in plain words and keeps the good ones', () => {
    const text = [header,
      row(['', 'SAP', 'SAP Ariba', 'Buying.', 'http://ariba.com', 'Ariba buys things for you.', '']),
      row(['', 'SAP', 'SAP Concur', 'Expenses at £5 per user.', 'https://www.concur.com', 'Concur handles expenses.', '']),
      row(['', 'SAP', 'SAP Fieldglass', 'Contingent workforce.', 'https://www.fieldglass.com', 'Fieldglass manages contractors.', 'integration']),
    ].join('\n');
    const { rows, problems } = parseResearch(text);
    expect(rows.map((r) => r.product)).toEqual(['SAP Fieldglass']);
    expect(rows[0]?.kind).toBe('integration');
    expect(problems.map((p) => p.text)).toEqual([
      'Line 2 (SAP Ariba): the source link is not a public https web address.',
      'Line 3 (SAP Concur): it mentions a price or cost, which the catalogue never holds.',
    ]);
  });
  it('offers a prompt that asks for the same columns and forbids prices', () => {
    expect(RESEARCH_PROMPT).toContain('Platform | Vendor | Product or module | Summary | Source link | Quoted sentence | Kind');
    expect(RESEARCH_PROMPT).toContain('Never include prices');
  });
});

describe('groupResearch', () => {
  const library = [{ id: 'p-s4', vendor: 'SAP', product: 'SAP S/4HANA' }, { id: 'p-fin', vendor: 'SAP', product: 'S/4HANA Finance' }];
  const parsed = (lines: string[][]) => parseResearch([header, ...lines.map(row)].join('\n')).rows;

  it('makes one product from several rows, links components to a platform in the library, and leaves known products alone', () => {
    const items = groupResearch(parsed([
      ['SAP S/4HANA', 'SAP', 'SAP S/4HANA Asset Management', 'Maintains assets.', 'https://www.sap.com/a', 'Asset Management keeps plants running.', ''],
      ['SAP S/4HANA', 'SAP', 'SAP S/4HANA Asset Management', 'Maintains assets.', 'https://www.sap.com/b', 'Asset Management plans maintenance work.', ''],
      ['SAP S/4HANA', 'SAP', 'SAP S/4HANA Finance', 'Ledgers.', 'https://www.sap.com/f', 'Finance runs the close quickly.', ''],
    ]), library);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ product: 'SAP S/4HANA Asset Management', platform: 'SAP S/4HANA', platformId: 'p-s4', existingId: null });
    expect(items[0]?.claims).toHaveLength(2);
    expect(items[1]?.existingId).toBe('p-fin');
  });
  it('lists a platform to add first when neither the library nor the rows have it', () => {
    const items = groupResearch(parsed([
      ['Kraken', 'Kraken Technologies', 'Kraken Billing', 'Bills customers.', 'https://kraken.tech/b', 'Kraken Billing produces accurate bills.', ''],
      ['Autodesk Construction Cloud', 'Autodesk', 'Autodesk Construction Cloud', 'Construction suite.', 'https://construction.autodesk.com', 'Autodesk Construction Cloud connects teams.', ''],
      ['Autodesk Construction Cloud', 'Autodesk', 'Autodesk Docs', 'Documents.', 'https://construction.autodesk.com/docs', 'Autodesk Docs is a document system.', ''],
    ]), library);
    expect(platformsToCreate(items)).toEqual([{ vendor: 'Kraken Technologies', product: 'Kraken' }]);
    expect(items.find((i) => i.product === 'Autodesk Construction Cloud')?.platform).toBeNull();
  });
});

describe('researchContent', () => {
  it('saves the quoted sentence as the claim, with no origin and no capability links, under its platform', () => {
    const [item] = groupResearch(parseResearch([header, row(['Kraken', 'Kraken Technologies', 'Kraken Billing', 'Bills customers.', 'https://kraken.tech/b', 'Kraken Billing produces accurate bills.', 'Functional'])].join('\n')).rows, []);
    if (item === undefined) throw new Error('no item');
    const content = researchContent(item, 'plat-1', new Set(), '2026-11-28');
    expect(content).toMatchObject({ product: 'Kraken Billing', vendor: 'Kraken Technologies', partOfProductId: 'plat-1', capabilities: [] });
    expect(content.claims).toEqual([{ position: 1, kind: 'functional', statement: 'Kraken Billing produces accurate bills.', sourceUrl: 'https://kraken.tech/b', sourceDate: '2026-11-28' }]);
    expect('partOfProductId' in researchContent(item, null, new Set(), '2026-11-28')).toBe(false);
  });
});
