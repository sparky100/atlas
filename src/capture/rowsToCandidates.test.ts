import { describe, expect, it } from 'vitest';
import type { ElementProposal, RelationshipProposal } from '../contracts/capture';
import type { ElementType } from '../contracts/delta';
import { resolveColumnRoles } from './columnSynonyms';
import type { RawSheet } from './parse/sheetGrid';
import { rowsToCandidates, type RowsToCandidatesResult } from './rowsToCandidates';

function run(headers: string[], dataRows: string[][], sheetType: ElementType = 'system'): RowsToCandidatesResult {
  const { roles, nameColumnIndex } = resolveColumnRoles({ headers });
  if (nameColumnIndex === null) throw new Error('test setup: no name column resolved');
  const grid = [headers, ...dataRows];
  const rawSheet: RawSheet = { sheetName: 'Sheet1', grid, cellMeta: new Map() };
  const headerColumnRefs = headers.map((_, i) => String.fromCharCode(65 + i));
  return rowsToCandidates({ sheetName: 'Sheet1', sheetType, headers, headerColumnRefs, roles, nameColumnIndex, rawSheet, headerRowIndex: 0 });
}

/** `attributes` is widened to `Record<string, unknown>` for test convenience — these assertions read arbitrary attribute keys without narrowing `elementType` first, which real pipeline code always does. */
function elementProposals(result: RowsToCandidatesResult): { seq: number; proposal: Omit<ElementProposal, 'attributes'> & { attributes: Record<string, unknown> } }[] {
  return result.candidates
    .filter((c): c is typeof c & { proposal: ElementProposal } => c.proposal.kind === 'element')
    .map((c) => ({ seq: c.seq, proposal: c.proposal }));
}

function relationshipProposals(result: RowsToCandidatesResult): { seq: number; proposal: RelationshipProposal }[] {
  return result.candidates.filter((c): c is typeof c & { proposal: RelationshipProposal } => c.proposal.kind === 'relationship').map((c) => ({ seq: c.seq, proposal: c.proposal }));
}

describe('rowsToCandidates — basic element extraction', () => {
  it('produces one system candidate per row, with defaulted lifecycleStatus/isExternal when neither column exists', () => {
    const result = run(['Application', 'Supplier'], [['CRM', 'Acme']]);
    const elements = elementProposals(result);
    expect(elements).toHaveLength(1);
    expect(elements[0]?.proposal).toMatchObject({ elementType: 'system', name: 'CRM', attributes: { vendor: 'Acme', lifecycleStatus: 'active', isExternal: false } });

    const candidate = result.candidates[0];
    expect(candidate?.evidence.attributeConfidence.lifecycleStatus).toBe(0.6);
    expect(candidate?.evidence.attributeConfidence.isExternal).toBe(0.6);
    expect(candidate?.evidence.attributeConfidence.vendor).toBeCloseTo(0.95, 5);
  });

  it('does not default lifecycleStatus/isExternal when the document states them', () => {
    const result = run(['Application', 'Status', 'External'], [['CRM', 'Retired', 'Yes']]);
    const [element] = elementProposals(result);
    expect(element?.proposal.attributes).toMatchObject({ lifecycleStatus: 'retired', isExternal: true });
  });

  it('picks up atlasId and sourceKey as matching hints, plus a source_system_key alias proposal', () => {
    const result = run(['Atlas ID', 'Application', 'Asset ID'], [['11111111-1111-1111-1111-111111111111', 'CRM', 'APP-42']]);
    const candidate = result.candidates[0];
    expect(candidate?.matchHints).toEqual({ atlasId: '11111111-1111-1111-1111-111111111111', sourceKeys: ['APP-42'] });
    expect(candidate?.aliasProposals).toContainEqual({ type: 'source_system_key', value: 'APP-42' });
  });

  it('keeps the first value of a multi-value cell, warns, and preserves the whole cell in the passage', () => {
    const result = run(['Application', 'Supplier'], [['CRM', 'Civica / Northgate']]);
    const [element] = elementProposals(result);
    expect(element?.proposal.attributes.vendor).toBe('Civica');
    const [candidate] = result.candidates;
    expect(candidate?.evidence.warnings).toContainEqual({ code: 'MULTI_VALUE_CELL', cell: 'B2' });
    expect(candidate?.evidence.passage).toContain('Civica / Northgate');
  });

  it('records a capability-column row (system name, text, source ref) for prompt C, deferred to capabilityAssignment.ts', () => {
    const result = run(['Application', 'Business area'], [['CRM', 'Customer Service']]);
    const [candidate] = result.candidates;
    expect(result.capabilityRows).toEqual([{ seq: candidate?.seq, systemName: 'CRM', capabilityText: 'Customer Service', sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: 'B2' } }]);
  });

  it('skips a row whose name cell is blank', () => {
    const result = run(['Application', 'Supplier'], [['', 'Acme']]);
    expect(result.candidates).toHaveLength(0);
  });
});

describe('rowsToCandidates — a capability sheet\'s parent column', () => {
  it('reads each capability\'s parent capability as unresolved text, blank for a top-level one', () => {
    const headers = ['Capability name', 'Parent capability'];
    const { roles } = resolveColumnRoles({ headers, llmAssignments: new Map([[0, { role: 'name', confidence: 0.9 }]]) });
    const grid = [headers, ['Connections', 'Customer'], ['Customer', '']];
    const rawSheet: RawSheet = { sheetName: 'Capabilities', grid, cellMeta: new Map() };
    const result = rowsToCandidates({ sheetName: 'Capabilities', sheetType: 'capability', headers, headerColumnRefs: ['A', 'B'], roles, nameColumnIndex: 0, rawSheet, headerRowIndex: 0 });
    const parents = elementProposals(result).map((c) => [c.proposal.name, c.proposal.parent]);
    expect(parents).toEqual([
      ['Connections', { kind: 'unresolved', text: 'Customer' }],
      ['Customer', null],
    ]);
  });
});

describe('rowsToCandidates — the attribute columns this product\'s export writes', () => {
  const attributesOf = (headers: string[], row: string[], sheetType: ElementType = 'system') => elementProposals(run(headers, [row], sheetType))[0]?.proposal.attributes;

  it('reads kind, criticality, domain, version and run cost against the system schema — a stored key, a spaced key, or a label', () => {
    const attributes = attributesOf(['Name', 'Kind', 'Criticality', 'IT/OT domain', 'Version', 'Run cost', 'Hosting model'], ['SAP', 'platform', 'High', 'hybrid', '4.2', 'Under £50k', 'private cloud']);
    expect(attributes).toMatchObject({ kind: 'platform', criticality: 'high', domain: 'hybrid', version: '4.2', annualRunCost: 'under_50k', hostingModel: 'private_cloud' });
  });

  it('reads the dates, including support end', () => {
    expect(attributesOf(['Name', 'Introduced', 'Planned end', 'Vendor support ends'], ['SAP', '2019-04-01', '2031-12-31', '2030-06-30'])).toMatchObject({ introduced: '2019-04-01', plannedEnd: '2031-12-31', supportEndsAt: '2030-06-30' });
  });

  it('warns ENUM_UNPARSED, and records nothing, for a value outside the attribute\'s options', () => {
    const result = run(['Name', 'Criticality'], [['SAP', 'mission critical']]);
    expect(elementProposals(result)[0]?.proposal.attributes).not.toHaveProperty('criticality');
    expect(result.candidates[0]?.evidence.warnings).toContainEqual({ code: 'ENUM_UNPARSED', cell: 'B2', raw: 'mission critical' });
  });

  it('skips, without a warning, an attribute the element type does not have (a Kind on a capability)', () => {
    const result = run(['Name', 'Kind', 'Reference'], [['Customer', 'platform', 'CUS-1']], 'capability');
    expect(elementProposals(result)[0]?.proposal.attributes).toEqual({ code: 'CUS-1' });
    expect(result.candidates[0]?.evidence.warnings).toEqual([]);
  });

  it('reads a capability\'s importance and essential-function flag', () => {
    expect(attributesOf(['Name', 'Importance', 'Essential function (NIS/CAF)'], ['Customer', 'high', 'Yes'], 'capability')).toMatchObject({ importance: 'high', essentialFunction: true });
  });
});

describe('rowsToCandidates — an actor row', () => {
  it('reads the actor\'s own type, email and org unit, and the person/team guess is not used for a stated type', () => {
    const [actor] = elementProposals(run(['Name', 'Actor type', 'Email', 'Org unit', 'External'], [['Network Team', 'team', 'network.team@example.org', 'Networks', 'No']], 'actor'));
    expect(actor?.proposal.attributes).toMatchObject({ subtype: 'team', email: 'network.team@example.org', orgUnit: 'Networks', isExternal: false });
  });

  it('warns ENUM_UNPARSED for an actor type that is not person, team or organisation', () => {
    const result = run(['Name', 'Actor type', 'Description'], [['Network Team', 'squad', 'x']], 'actor');
    expect(elementProposals(result)[0]?.proposal.attributes).not.toHaveProperty('subtype');
    expect(result.candidates[0]?.evidence.warnings).toContainEqual({ code: 'ENUM_UNPARSED', cell: 'B2', raw: 'squad' });
  });

  it('an Actor type column on a system sheet is ignored — only an actor has one', () => {
    expect(elementProposals(run(['Name', 'Actor type', 'Description'], [['Aurora', 'team', 'x']]))[0]?.proposal.attributes).not.toHaveProperty('subtype');
  });
});

describe('rowsToCandidates — intra-document duplicates', () => {
  it('collapses rows whose normalised (type, name) is an exact match into one candidate with an alias per row', () => {
    const result = run(['Application', 'Supplier'], [['PowerON', 'Acme'], ['POWERON', 'Acme'], ['poweron', 'Acme']]);
    const elements = elementProposals(result);
    expect(elements).toHaveLength(1);
    const [candidate] = result.candidates;
    expect(candidate?.aliasProposals.filter((a) => a.type === 'name')).toHaveLength(3);
  });

  it('keeps the first row\'s value on disagreement and warns ROWS_DISAGREE, without dropping the candidate', () => {
    const result = run(['Application', 'Supplier'], [['PowerON', 'Acme'], ['PowerON', 'Enzen']]);
    const [element] = elementProposals(result);
    expect(element?.proposal.attributes.vendor).toBe('Acme');
    const [candidate] = result.candidates;
    expect(candidate?.evidence.warnings.some((w) => w.code === 'ROWS_DISAGREE')).toBe(true);
  });

  it('never lets two differently-named rows collapse into one candidate', () => {
    const result = run(['Application', 'Supplier'], [['CRM', 'Acme'], ['ERP', 'Beta']]);
    expect(elementProposals(result)).toHaveLength(2);
  });
});

describe('rowsToCandidates — owner / technicalOwner', () => {
  it('creates a team actor and an owns(business) relationship for an owner column', () => {
    const result = run(['Application', 'Owner'], [['CRM', 'IT Operations Team']]);
    const elements = elementProposals(result);
    const actor = elements.find((e) => e.proposal.elementType === 'actor');
    expect(actor?.proposal).toMatchObject({ name: 'IT Operations Team', attributes: { subtype: 'team' } });

    const [relationship] = relationshipProposals(result);
    expect(relationship?.proposal).toMatchObject({ relationshipType: 'owns', attributes: { role: 'business' }, from: { kind: 'candidate', seq: actor?.seq }, to: { kind: 'candidate' } });
  });

  it('infers a person subtype from a Firstname Surname owner value', () => {
    const result = run(['Application', 'Owner'], [['CRM', 'Priya Patel']]);
    const actor = elementProposals(result).find((e) => e.proposal.elementType === 'actor');
    expect(actor?.proposal.attributes.subtype).toBe('person');
  });

  it('attaches ownerEmail to the same owner actor and forces subtype to person', () => {
    const result = run(['Application', 'Owner', 'Owner email'], [['CRM', 'Support Team', 'lead@example.com']]);
    const actor = elementProposals(result).find((e) => e.proposal.elementType === 'actor');
    expect(actor?.proposal.attributes).toMatchObject({ subtype: 'person', email: 'lead@example.com' });
  });

  it('produces a separate owns(technical) relationship for technicalOwner, sharing the actor group when names match', () => {
    const result = run(['Application', 'Owner', 'Technical owner'], [['CRM', 'Finance Team', 'Finance Team']]);
    const actors = elementProposals(result).filter((e) => e.proposal.elementType === 'actor');
    expect(actors).toHaveLength(1); // same normalised name collapses into one actor.
    const relationships = relationshipProposals(result);
    expect(relationships.map((r) => (r.proposal as RelationshipProposal<'owns'>).attributes.role).sort()).toEqual(['business', 'technical']);
  });
});

describe('rowsToCandidates — usesSystems / flowsTo', () => {
  it('splits a multi-value usesSystems cell into one relationship candidate per value, endpoints unresolved', () => {
    const result = run(['Application', 'Depends on'], [['CRM', 'Billing; Identity Provider']]);
    const relationships = relationshipProposals(result).filter((r) => r.proposal.relationshipType === 'uses');
    expect(relationships).toHaveLength(2);
    expect(relationships.map((r) => (r.proposal.to as { text: string }).text)).toEqual(['Billing', 'Identity Provider']);
  });

  it('carries the integrationPlatform column as viaHint, not inside attributes', () => {
    const result = run(['Application', 'Depends on', 'Integration platform'], [['CRM', 'Billing', 'Enterprise Bus']]);
    const candidate = result.candidates.find((c) => c.proposal.kind === 'relationship' && c.proposal.relationshipType === 'uses');
    expect(candidate?.viaHint).toBe('Enterprise Bus');
    expect((candidate?.proposal as RelationshipProposal<'uses'> | undefined)?.attributes).not.toHaveProperty('via');
  });
});

describe('rowsToCandidates — container parent', () => {
  it('proposes an unresolved parent ref for a container sheet\'s parent column', () => {
    const result = run(['Module', 'Parent system'], [['Billing', 'CRM']], 'container');
    const [element] = elementProposals(result);
    expect(element?.proposal.parent).toEqual({ kind: 'unresolved', text: 'CRM' });
  });

  it('leaves parent null on a container sheet\'s own row with a blank parent cell', () => {
    const result = run(['Module', 'Parent system'], [['Billing', '']], 'container');
    const [element] = elementProposals(result);
    expect(element?.proposal.parent).toBeNull();
  });

  describe('mixed system/module sheet (Sprint F2b, SPEC-capture.md §5.2)', () => {
    it('treats a system-sheet row with a blank parent cell as a system, parent null', () => {
      const result = run(['Application', 'Parent system'], [['CRM', '']], 'system');
      const [element] = elementProposals(result);
      expect(element?.proposal.elementType).toBe('system');
      expect(element?.proposal.parent).toBeNull();
    });

    it('treats a system-sheet row with a filled parent cell as a container, parent unresolved', () => {
      const result = run(['Application', 'Parent system'], [['Billing', 'CRM']], 'system');
      const [element] = elementProposals(result);
      expect(element?.proposal.elementType).toBe('container');
      expect(element?.proposal.parent).toEqual({ kind: 'unresolved', text: 'CRM' });
    });

    it('lets one sheet mix top-level systems and platform modules', () => {
      const result = run(['Application', 'Parent system'], [['CRM', ''], ['Billing', 'CRM']], 'system');
      const elements = elementProposals(result);
      expect(elements.find((e) => e.proposal.name === 'CRM')?.proposal.elementType).toBe('system');
      expect(elements.find((e) => e.proposal.name === 'Billing')?.proposal.elementType).toBe('container');
    });
  });
});

describe('rowsToCandidates — owner external syntax (Sprint F2b, SPEC-capture.md §5.2)', () => {
  it('parses "Name (External: Org)" into an organisation actor, isExternal true', () => {
    const result = run(['Application', 'Owner'], [['CRM', 'Civica (External: Civica Group)']]);
    const actor = elementProposals(result).find((e) => e.proposal.elementType === 'actor');
    expect(actor?.proposal).toMatchObject({ name: 'Civica', attributes: { subtype: 'organisation', isExternal: true, externalOrganisation: 'Civica Group' } });
  });

  it('groups a plain-name reference and an external-syntax reference to the same owner into one actor', () => {
    const result = run(['Application', 'Owner'], [['CRM', 'Civica (External: Civica Group)'], ['Billing', 'Civica']]);
    const actors = elementProposals(result).filter((e) => e.proposal.elementType === 'actor');
    expect(actors).toHaveLength(1);
  });

  it('does not downgrade an external owner to person when an ownerEmail column is present', () => {
    const result = run(['Application', 'Owner', 'Owner email'], [['CRM', 'Civica (External: Civica Group)', 'contact@civica.example']]);
    const actor = elementProposals(result).find((e) => e.proposal.elementType === 'actor');
    expect(actor?.proposal.attributes).toMatchObject({ subtype: 'organisation', email: 'contact@civica.example' });
  });
});

describe('rowsToCandidates — formula-error cells', () => {
  it('warns FORMULA_ERROR on the candidate even though the erroring cell reads as blank (no value is set for that attribute)', () => {
    const headers = ['Application', 'Supplier'];
    const { roles, nameColumnIndex } = resolveColumnRoles({ headers });
    if (nameColumnIndex === null) throw new Error('test setup: no name column resolved');
    const rawSheet: RawSheet = {
      sheetName: 'Sheet1',
      grid: [headers, ['CRM', '']],
      cellMeta: new Map([['1,1', { formulaError: true }]]),
    };
    const result = rowsToCandidates({ sheetName: 'Sheet1', sheetType: 'system', headers, headerColumnRefs: ['A', 'B'], roles, nameColumnIndex, rawSheet, headerRowIndex: 0 });
    const [element] = elementProposals(result);
    expect(element?.proposal.attributes.vendor).toBeUndefined();
    expect(result.candidates[0]?.evidence.warnings).toContainEqual({ code: 'FORMULA_ERROR', cell: 'B2' });
  });
});

describe('rowsToCandidates — a Fit column (owner-approved importer exception, 2026-11-17)', () => {
  it('carries the fit onto the row\'s capability link, case-insensitively', () => {
    const result = run(['Application', 'Capability', 'Fit'], [['CRM', 'Customer Service', 'Good'], ['Billing', 'Finance', 'POOR']]);
    expect(result.capabilityRows.map((r) => [r.systemName, r.fit])).toEqual([['CRM', 'good'], ['Billing', 'poor']]);
  });

  it('leaves fit off when the cell is blank, and warns (without guessing) when it is not one of the four ratings', () => {
    const blank = run(['Application', 'Capability', 'Fit'], [['CRM', 'Customer Service', '']]);
    expect(blank.capabilityRows[0]).not.toHaveProperty('fit');
    const odd = run(['Application', 'Capability', 'Fit'], [['CRM', 'Customer Service', 'Fantastic']]);
    expect(odd.capabilityRows[0]).not.toHaveProperty('fit');
    expect(odd.candidates[0]?.evidence.warnings).toContainEqual({ code: 'ENUM_UNPARSED', cell: 'C2', raw: 'Fantastic' });
  });

  it('treats the app\'s own "Unrated" and "Not rated" as blank, not as a bad value', () => {
    const result = run(['Application', 'Capability', 'Fit'], [['CRM', 'Customer Service', 'Unrated'], ['Billing', 'Finance', 'Not rated']]);
    expect(result.capabilityRows.every((r) => r.fit === undefined)).toBe(true);
    expect(result.candidates.every((c) => c.evidence.warnings.length === 0)).toBe(true);
  });

  it('has no effect when the row names no capability', () => {
    const result = run(['Application', 'Fit'], [['CRM', 'good']]);
    expect(result.capabilityRows).toEqual([]);
  });
});
