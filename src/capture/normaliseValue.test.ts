import { describe, expect, it } from 'vitest';
import { looksLikePersonName, parseBool, parseDate, parseEmail, parseHostingModel, parseLifecycle, parseName } from './normaliseValue';

describe('parseLifecycle', () => {
  it('matches an exact enum value with no fuzzy flag', () => {
    expect(parseLifecycle('active')).toEqual({ value: 'active', fuzzy: false });
    expect(parseLifecycle('Active')).toEqual({ value: 'active', fuzzy: false });
  });

  it('matches every fuzzy synonym from §5.4\'s own table', () => {
    expect(parseLifecycle('live')).toEqual({ value: 'active', fuzzy: true });
    expect(parseLifecycle('in service')).toEqual({ value: 'active', fuzzy: true });
    expect(parseLifecycle('pipeline')).toEqual({ value: 'planned', fuzzy: true });
    expect(parseLifecycle('sunset')).toEqual({ value: 'retiring', fuzzy: true });
    expect(parseLifecycle('decommissioned')).toEqual({ value: 'retired', fuzzy: true });
  });

  it('is null for anything unrecognised — never a guess', () => {
    expect(parseLifecycle('unknown status')).toBeNull();
  });
});

describe('parseHostingModel', () => {
  it('matches an exact enum value', () => {
    expect(parseHostingModel('saas')).toEqual({ value: 'saas', fuzzy: false });
  });

  it('matches disclosed synonyms', () => {
    expect(parseHostingModel('on-prem')).toEqual({ value: 'on_premises', fuzzy: true });
    expect(parseHostingModel('private cloud')).toEqual({ value: 'private_cloud', fuzzy: true });
  });

  it('never guesses an ambiguous bare "cloud"', () => {
    expect(parseHostingModel('cloud')).toBeNull();
  });
});

describe('parseDate', () => {
  it('parses ISO dates exactly, unambiguous', () => {
    expect(parseDate('2026-03-14')).toEqual({ value: '2026-03-14', ambiguous: false });
  });

  it('defaults dd/mm/yyyy (UK) when both readings would be valid', () => {
    expect(parseDate('03/04/2026')).toEqual({ value: '2026-04-03', ambiguous: false });
  });

  it('swaps to mm/dd/yyyy only when the second number cannot be a month', () => {
    expect(parseDate('04/25/2026')).toEqual({ value: '2026-04-25', ambiguous: false });
  });

  it('is null when neither reading is a valid month', () => {
    expect(parseDate('13/25/2026')).toBeNull();
  });

  it('parses "Mon yyyy" to the first of the month, flagged ambiguous', () => {
    expect(parseDate('Mar 2026')).toEqual({ value: '2026-03-01', ambiguous: true });
    expect(parseDate('March 2026')).toEqual({ value: '2026-03-01', ambiguous: true });
  });

  it('parses "yyyy-Qn" to the first of the quarter, flagged ambiguous', () => {
    expect(parseDate('2026-Q1')).toEqual({ value: '2026-01-01', ambiguous: true });
    expect(parseDate('2026-Q3')).toEqual({ value: '2026-07-01', ambiguous: true });
  });

  it('parses a bare year to 1 January, flagged ambiguous', () => {
    expect(parseDate('2026')).toEqual({ value: '2026-01-01', ambiguous: true });
  });

  it('is null for unparseable text', () => {
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('parseBool', () => {
  it('recognises every listed true/false phrase, case-insensitively', () => {
    for (const raw of ['yes', 'True', 'EXTERNAL', 'saas', 'Hosted']) expect(parseBool(raw)).toBe(true);
    for (const raw of ['no', 'False', 'INTERNAL', 'on-prem']) expect(parseBool(raw)).toBe(false);
  });

  it('omits anything else rather than guessing', () => {
    expect(parseBool('maybe')).toBeNull();
  });
});

describe('parseEmail', () => {
  it('accepts a plausible email', () => {
    expect(parseEmail('a.person@example.com')).toBe('a.person@example.com');
  });

  it('omits anything that does not look like an email', () => {
    expect(parseEmail('not an email')).toBeNull();
  });
});

describe('parseName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(parseName('  Legacy   CRM  ')).toEqual({ name: 'Legacy CRM' });
  });

  it('keeps a "(legacy)" suffix and proposes the bare stem as an alias', () => {
    expect(parseName('Northgate Payroll (legacy)')).toEqual({ name: 'Northgate Payroll (legacy)', stemAlias: 'Northgate Payroll' });
  });

  it('keeps a "- old" suffix and proposes the stem', () => {
    expect(parseName('Widget Co - old')).toEqual({ name: 'Widget Co - old', stemAlias: 'Widget Co' });
  });

  it('keeps a "v2"-style suffix and proposes the stem', () => {
    expect(parseName('Billing Engine v2')).toEqual({ name: 'Billing Engine v2', stemAlias: 'Billing Engine' });
  });

  it('proposes no stem alias when there is no recognised suffix', () => {
    expect(parseName('Ordinary System Name')).toEqual({ name: 'Ordinary System Name' });
  });
});

describe('looksLikePersonName', () => {
  it('is true for an email', () => {
    expect(looksLikePersonName('a.person@example.com')).toBe(true);
  });

  it('is true for "Firstname Surname"', () => {
    expect(looksLikePersonName('Priya Patel')).toBe(true);
  });

  it('is false for a multi-word team/department name', () => {
    expect(looksLikePersonName('IT Operations Team')).toBe(false);
  });

  it('cannot distinguish a two-word team name from a person — a disclosed heuristic limit, not a bug', () => {
    // "Platform Engineering" is syntactically identical to "Firstname Surname"; §5.4 names no
    // stronger rule than "looks like Firstname Surname," so this stays a known false positive.
    expect(looksLikePersonName('Platform Engineering')).toBe(true);
  });
});
