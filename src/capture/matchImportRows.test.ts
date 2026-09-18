import { describe, expect, it } from 'vitest';
import type { Json } from '../contracts/rows';
import type { ElementsHeadRow } from '../contracts/rows';
import type { ImportRow } from './importRowSchema';
import { matchImportRows, type MatchImportRowsInput } from './matchImportRows';

function system(id: string, name: string, attributes: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes, exists_delta_id: `${id}-create` };
}
function container(id: string, name: string, parentId: string | null): ElementsHeadRow {
  return { element_id: id, element_type: 'container', name, parent_id: parentId, attributes: {}, exists_delta_id: `${id}-create` };
}
function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `${id}-create` };
}
function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: 'person', isExternal: false }, exists_delta_id: `${id}-create` };
}
function row(overrides: Partial<ImportRow> & { rowNumber: number; name: string }): ImportRow {
  return { elementType: 'system', attributes: {}, isExternal: undefined, platformName: null, capabilityNames: [], businessOwner: null, technicalOwner: null, ...overrides };
}
function match(rows: ImportRow[], overrides: Partial<MatchImportRowsInput> = {}) {
  return matchImportRows({ rows, systems: [], containers: [], capabilities: [], actors: [], aliasesByElementId: new Map(), ...overrides });
}

describe('matchImportRows — a row’s own identity', () => {
  it('matches by exact normalized name', () => {
    const systems = [system('sys-1', 'Northgate')];
    const [result] = match([row({ rowNumber: 2, name: '  NORTHGATE  ' })], { systems });
    expect(result?.match).toEqual({ kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } });
  });

  it('matches by an alias, even when the row’s own name differs entirely', () => {
    const systems = [system('sys-1', 'Northgate')];
    const aliasesByElementId = new Map([['sys-1', ['Riverside Payments']]]);
    const [result] = match([row({ rowNumber: 2, name: 'Riverside Payments' })], { systems, aliasesByElementId });
    expect(result?.match).toEqual({ kind: 'matched', element: { elementId: 'sys-1', name: 'Northgate' } });
  });

  it('is new when nothing matches by name, alias, or fuzzy similarity', () => {
    const [result] = match([row({ rowNumber: 2, name: 'Brand New System' })], { systems: [system('sys-1', 'Northgate')] });
    expect(result?.match).toEqual({ kind: 'new' });
  });

  it('an exact tie (two live elements share the exact normalized name) needs a pick', () => {
    const systems = [system('sys-1', 'Northgate'), system('sys-2', 'northgate')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate' })], { systems });
    expect(result?.match.kind).toBe('undecided');
    if (result?.match.kind === 'undecided') {
      expect(result.match.candidates.map((c) => c.elementId).sort()).toEqual(['sys-1', 'sys-2']);
    }
  });

  describe('a near-match always needs a pick — never auto-resolved, even a lone leader', () => {
    it('a single fuzzy candidate well above the 0.6 threshold still needs a pick', () => {
      // trigramSimilarity(normalizeName('Northgatte'), normalizeName('Northgate')) = 0.750
      const systems = [system('sys-1', 'Northgate')];
      const [result] = match([row({ rowNumber: 2, name: 'Northgatte' })], { systems });
      expect(result?.match).toEqual({ kind: 'undecided', candidates: [{ elementId: 'sys-1', name: 'Northgate' }] });
    });

    it('stays new when the best fuzzy score is still below the 0.6 threshold', () => {
      // trigramSimilarity('council tax system', 'council tax servicing') = 0.464 — real overlap, still not a match.
      const systems = [system('sys-1', 'Council Tax Servicing')];
      const [result] = match([row({ rowNumber: 2, name: 'Council Tax System' })], { systems });
      expect(result?.match).toEqual({ kind: 'new' });
    });

    it('every candidate scoring above the threshold is offered, not narrowed to two', () => {
      // trigramSimilarity('riverside payments', 'riverside payment') = 0.850
      // trigramSimilarity('riverside payments', 'riverside paymentss') = 0.857
      const systems = [system('sys-1', 'Riverside Payment'), system('sys-2', 'Riverside Paymentss')];
      const [result] = match([row({ rowNumber: 2, name: 'Riverside Payments' })], { systems });
      expect(result?.match.kind).toBe('undecided');
      if (result?.match.kind === 'undecided') {
        expect(result.match.candidates.map((c) => c.elementId).sort()).toEqual(['sys-1', 'sys-2']);
      }
    });

    it('never falls through to the fuzzy tier when the exact tier already found a tie', () => {
      const systems = [system('sys-1', 'Northgate'), system('sys-2', 'northgate'), system('sys-3', 'Northgatte')];
      const [result] = match([row({ rowNumber: 2, name: 'Northgate' })], { systems });
      expect(result?.match.kind).toBe('undecided');
      if (result?.match.kind === 'undecided') {
        expect(result.match.candidates.map((c) => c.elementId).sort()).toEqual(['sys-1', 'sys-2']);
      }
    });
  });
});

describe('matchImportRows — a module row’s own platform', () => {
  it('resolves the platform by exact name among kind=platform systems only', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('other-1', 'Other')];
    const [result] = match([row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'SAP' })], { systems });
    expect(result?.platform).toEqual({ kind: 'matched', element: { elementId: 'sap-1', name: 'SAP' } });
  });

  it('blocks the row when the named platform does not exist — never auto-created', () => {
    const [result] = match([row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'SAP' })], { systems: [] });
    expect(result?.match).toEqual({ kind: 'blocked', reason: expect.stringContaining('not found') });
  });

  it('blocks the row when the named platform is ambiguous', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('sap-2', 'sap', { kind: 'platform' })];
    const [result] = match([row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'SAP' })], { systems });
    expect(result?.match).toEqual({ kind: 'blocked', reason: expect.stringContaining('more than one') });
  });

  it('once the platform resolves, the module’s own identity is matched only among that platform’s own modules', () => {
    const systems = [system('sap-1', 'SAP', { kind: 'platform' }), system('other-1', 'Other', { kind: 'platform' })];
    const containers = [container('pm-1', 'PM', 'sap-1'), container('pm-2', 'PM', 'other-1')];
    const [result] = match([row({ rowNumber: 2, name: 'PM', elementType: 'container', platformName: 'SAP' })], { systems, containers });
    expect(result?.match).toEqual({ kind: 'matched', element: { elementId: 'pm-1', name: 'PM' } });
  });
});

describe('matchImportRows — capability/owner references (auto-resolving cascade, distinct from row identity)', () => {
  it('resolves capability by exact name', () => {
    const capabilities = [capability('cap-1', 'Billing')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] })], { capabilities });
    expect(result?.capabilities).toEqual([{ kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } }]);
  });

  it('resolves a "|"-delimited list independently, one outcome per name, same order', () => {
    const capabilities = [capability('cap-1', 'Billing'), capability('cap-2', 'Customer Accounts')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing', 'Customer Accounts', 'Nonexistent'] })], { capabilities });
    expect(result?.capabilities).toEqual([
      { kind: 'matched', element: { elementId: 'cap-1', name: 'Billing' } },
      { kind: 'matched', element: { elementId: 'cap-2', name: 'Customer Accounts' } },
      { kind: 'new' },
    ]);
  });

  it('is new (never auto-created, never blocks the row) when the named capability does not exist', () => {
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Nonexistent'] })], { capabilities: [capability('cap-1', 'Billing')] });
    expect(result?.capabilities).toEqual([{ kind: 'new' }]);
  });

  it('is an empty list when the row does not name one', () => {
    const [result] = match([row({ rowNumber: 2, name: 'Northgate' })], { capabilities: [capability('cap-1', 'Billing')] });
    expect(result?.capabilities).toEqual([]);
  });

  it('is ambiguous when two capabilities share the exact normalized name', () => {
    const capabilities = [capability('cap-1', 'Billing'), capability('cap-2', 'BILLING')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] })], { capabilities });
    expect(result?.capabilities[0]?.kind).toBe('ambiguous');
  });

  it('auto-resolves a lone fuzzy leader for a reference column (unlike row identity)', () => {
    // trigramSimilarity('billing', 'biling') = 0.667
    const capabilities = [capability('cap-1', 'Biling')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', capabilityNames: ['Billing'] })], { capabilities });
    expect(result?.capabilities).toEqual([{ kind: 'matched', element: { elementId: 'cap-1', name: 'Biling' } }]);
  });

  it('resolves business_owner and technical_owner against actors independently', () => {
    const actors = [actor('actor-1', 'Jane Doe'), actor('actor-2', 'John Smith')];
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', businessOwner: { name: 'Jane Doe', externalOrganisation: null }, technicalOwner: { name: 'John Smith', externalOrganisation: null } })], { actors });
    expect(result?.businessOwner).toEqual({ kind: 'matched', element: { elementId: 'actor-1', name: 'Jane Doe' } });
    expect(result?.technicalOwner).toEqual({ kind: 'matched', element: { elementId: 'actor-2', name: 'John Smith' } });
  });

  it('is new for an owner name matching no live actor — the caller creates one', () => {
    const [result] = match([row({ rowNumber: 2, name: 'Northgate', businessOwner: { name: 'Jane Doe', externalOrganisation: null } })], { actors: [] });
    expect(result?.businessOwner).toEqual({ kind: 'new' });
  });
});
