import { describe, expect, it } from 'vitest';
import { GOALS_IMPORT_MAX_ROWS, parseGoalsRows, planGoalsImport, splitCapabilityNames, summarisePlan } from './goalsImport';

const caps = [
  { element_id: 'c1', name: 'Connect Customers' },
  { element_id: 'c2', name: 'Pay People' },
  { element_id: 'c3', name: 'Twice' },
  { element_id: 'c4', name: 'twice' },
];

describe('parseGoalsRows', () => {
  it('reads the standard headings, in any order, case and spacing, and skips blank rows', () => {
    const r = parseGoalsRows([
      ['Why_now', 'TITLE', 'What success looks like', 'Capabilities'],
      ['Contract ends', 'Cut costs', 'Run cost down', 'Pay People; Connect Customers'],
      ['', '', '', ''],
      ['', 'Second', 'Done', ''],
    ]);
    expect(r).toEqual({
      ok: true,
      rows: [
        { rowNumber: 2, title: 'Cut costs', statement: 'Run cost down', whyNow: 'Contract ends', capabilityNames: ['Pay People', 'Connect Customers'] },
        { rowNumber: 4, title: 'Second', statement: 'Done', whyNow: '', capabilityNames: [] },
      ],
    });
  });
  it('finds the heading row below a title line', () => {
    const r = parseGoalsRows([['My goals'], ['Goal', 'Success'], ['A', 'B']]);
    expect(r).toMatchObject({ ok: true, rows: [{ rowNumber: 3, title: 'A', statement: 'B' }] });
  });
  it('says why it cannot read a file', () => {
    expect(parseGoalsRows([['Foo', 'Bar'], ['1', '2']])).toEqual({ ok: false, reason: 'no-heading' });
    expect(parseGoalsRows([['Title', 'Success']])).toEqual({ ok: false, reason: 'no-rows' });
    const many = [['Title', 'Success'], ...Array.from({ length: GOALS_IMPORT_MAX_ROWS + 1 }, (_, i) => [`G${String(i)}`, 's'])];
    expect(parseGoalsRows(many)).toEqual({ ok: false, reason: 'too-many', max: GOALS_IMPORT_MAX_ROWS });
  });
});

describe('splitCapabilityNames', () => {
  it('splits on semicolons and line breaks, never commas, and drops repeats', () => {
    expect(splitCapabilityNames('A, B; C\nD; c ;')).toEqual(['A, B', 'C', 'D']);
  });
});

describe('planGoalsImport', () => {
  const rows = (...r: [string, string, string?, string[]?][]) => r.map(([title, statement, whyNow, capabilityNames], i) => ({ rowNumber: i + 2, title, statement, whyNow: whyNow ?? '', capabilityNames: capabilityNames ?? [] }));
  it('adds new goals, links capabilities by name, and reports names it cannot match', () => {
    const plan = planGoalsImport(rows(['Cut costs', 'Less', '', ['pay people', 'Nope', 'Twice']]), [], caps);
    expect(plan[0]).toMatchObject({ status: 'new', capabilityIds: ['c2'], unmatchedCapabilityNames: ['Nope', 'Twice'] });
  });
  it('skips a title that already exists (any case, retired too) and a title repeated in the file', () => {
    const plan = planGoalsImport(rows(['cut COSTS', 's'], ['Fresh', 's'], ['fresh', 's']), [{ title: 'Cut costs' }], caps);
    expect(plan.map((p) => p.status)).toEqual(['exists', 'new', 'repeated']);
  });
  it('refuses rows the form would refuse', () => {
    const plan = planGoalsImport(rows(['', 's'], ['T', ''], ['T'.repeat(121), 's']), [], caps);
    expect(plan.map((p) => p.problem)).toEqual(['title-empty', 'statement-empty', 'title-too-long']);
    expect(plan.every((p) => p.status === 'invalid')).toBe(true);
  });
  it('summarises', () => {
    const plan = planGoalsImport(rows(['A', 's', '', ['x']], ['B', 's'], ['', 's']), [{ title: 'B' }], caps);
    expect(summarisePlan(plan)).toEqual({ add: 1, exists: 1, repeated: 0, invalid: 1, unmatched: 1 });
  });
});
