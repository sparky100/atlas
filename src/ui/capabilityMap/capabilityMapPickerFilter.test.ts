import { describe, expect, it } from 'vitest';
import { filterCapabilityMaps, matchesCapabilityMapQuery } from './capabilityMapPickerFilter';
import type { CapabilityMapRow } from '../../db/capabilityMapTemplates';

function map(overrides: Partial<CapabilityMapRow> = {}): CapabilityMapRow {
  return {
    id: 'map-1',
    sector: 'nhs',
    version: 1,
    status: 'published',
    title: 'NHS Board or Trust',
    summary: 'Patient care and clinical quality.',
    source_description: 'Drafted from general familiarity with reference models.',
    published_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesCapabilityMapQuery', () => {
  it('matches a blank query against anything', () => {
    expect(matchesCapabilityMapQuery(map(), '')).toBe(true);
    expect(matchesCapabilityMapQuery(map(), '   ')).toBe(true);
  });

  it('matches title, case-insensitively', () => {
    expect(matchesCapabilityMapQuery(map(), 'board')).toBe(true);
    expect(matchesCapabilityMapQuery(map(), 'BOARD')).toBe(true);
  });

  it('matches sector and version', () => {
    expect(matchesCapabilityMapQuery(map(), 'nhs')).toBe(true);
    expect(matchesCapabilityMapQuery(map(), 'v1')).toBe(true);
  });

  it('matches summary', () => {
    expect(matchesCapabilityMapQuery(map(), 'clinical quality')).toBe(true);
  });

  it('does not match sourceDescription (provenance stays behind info, not searchable from the card face)', () => {
    expect(matchesCapabilityMapQuery(map(), 'general familiarity')).toBe(false);
  });

  it('does not match unrelated text', () => {
    expect(matchesCapabilityMapQuery(map(), 'housing')).toBe(false);
  });

  it('falls back gracefully when title/summary are null (a row not yet reloaded since 20260910010000)', () => {
    const row = map({ title: null, summary: null });
    expect(matchesCapabilityMapQuery(row, 'nhs')).toBe(true);
    expect(matchesCapabilityMapQuery(row, 'board')).toBe(false);
  });
});

describe('filterCapabilityMaps', () => {
  it('keeps only matching maps, preserving order', () => {
    const nhs = map({ id: 'nhs', sector: 'nhs', title: 'NHS Board or Trust' });
    const housing = map({ id: 'housing', sector: 'housing', title: 'Housing Association', summary: 'Tenancy and lettings.' });
    expect(filterCapabilityMaps([nhs, housing], 'housing')).toEqual([housing]);
    expect(filterCapabilityMaps([nhs, housing], '')).toEqual([nhs, housing]);
    expect(filterCapabilityMaps([nhs, housing], 'utility')).toEqual([]);
  });
});
