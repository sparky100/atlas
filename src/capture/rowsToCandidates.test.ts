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

  it('records raw capability-column text against the element\'s own seq, deferred for prompt C', () => {
    const result = run(['Application', 'Business area'], [['CRM', 'Customer Service']]);
    const [candidate] = result.candidates;
    expect(candidate ? result.capabilityColumnText.get(candidate.seq) : undefined).toBe('Customer Service');
  });

  it('skips a row whose name cell is blank', () => {
    const result = run(['Application', 'Supplier'], [['', 'Acme']]);
    expect(result.candidates).toHaveLength(0);
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

  it('leaves parent null when the sheet type is not container', () => {
    const result = run(['Application', 'Parent system'], [['CRM', 'Something']], 'system');
    const [element] = elementProposals(result);
    expect(element?.proposal.parent).toBeNull();
  });
});
