import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, ElementProposal, RelationshipProposal } from '../contracts/capture';
import { dedupeIntraDocumentCandidates, mergeSameNamedActors } from './intraDocumentDedup';
import type { RowCandidate } from './rowsToCandidates';

function evidence(passage: string, overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { sourceRef: { kind: 'sheet', sheet: 'Applications', range: 'A2' }, passage, extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [], ...overrides };
}

function elementCandidate(seq: number, name: string, overrides: Partial<RowCandidate> = {}): RowCandidate {
  const proposal: ElementProposal = { kind: 'element', elementType: 'system', name, parent: null, attributes: { isExternal: false } };
  return { seq, proposal, evidence: evidence(name), aliasProposals: [{ type: 'name', value: name }], ...overrides };
}

describe('dedupeIntraDocumentCandidates', () => {
  it('leaves distinct names alone', () => {
    const { candidates: result } = dedupeIntraDocumentCandidates([elementCandidate(0, 'CRM'), elementCandidate(1, 'Billing Platform')]);
    expect(result).toHaveLength(2);
  });

  // trigramSimilarity('poweron', 'poweron ltd') ≈ 0.667 — genuinely ≥ IDENTITY_TRIGRAM_THRESHOLD (0.6), unlike a bare word-order/spacing change (e.g. 'poweron' vs 'power on' ≈ 0.545, below threshold and deliberately left unmerged by this pass — see the "never merges a pair below the real trigram threshold" case below).
  it('merges a fuzzy spelling variant (trigram >= identity threshold) into the first-seen survivor', () => {
    const { candidates: result } = dedupeIntraDocumentCandidates([elementCandidate(0, 'PowerOn'), elementCandidate(1, 'PowerOn Ltd')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.seq).toBe(0);
  });

  it('never merges a pair whose real trigram similarity falls below the identity threshold, even if a human would read them as the same thing', () => {
    const { candidates: result } = dedupeIntraDocumentCandidates([elementCandidate(0, 'PowerOn'), elementCandidate(1, 'Power On')]);
    expect(result).toHaveLength(2);
  });

  it('never merges two rows that each name a different Atlas ID, however alike the names', () => {
    const a = elementCandidate(0, 'PowerOn', { matchHints: { atlasId: '11111111-1111-4111-8111-111111111111' } });
    const b = elementCandidate(1, 'PowerOn Ltd', { matchHints: { atlasId: '22222222-2222-4222-8222-222222222222' } });
    expect(dedupeIntraDocumentCandidates([a, b]).candidates).toHaveLength(2);
  });

  it('still merges alike names when only one row, or both rows with the same ID, name an Atlas ID', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(dedupeIntraDocumentCandidates([elementCandidate(0, 'PowerOn', { matchHints: { atlasId: id } }), elementCandidate(1, 'PowerOn Ltd')]).candidates).toHaveLength(1);
    expect(dedupeIntraDocumentCandidates([elementCandidate(0, 'PowerOn', { matchHints: { atlasId: id } }), elementCandidate(1, 'PowerOn Ltd', { matchHints: { atlasId: id } })]).candidates).toHaveLength(1);
  });

  it('unions attributes the duplicate stated and the survivor did not', () => {
    const first = elementCandidate(0, 'PowerOn', { evidence: evidence('PowerOn', { attributeConfidence: { name: 0.95 } }) });
    const dup: RowCandidate = { ...elementCandidate(1, 'PowerOn Ltd'), proposal: { kind: 'element', elementType: 'system', name: 'PowerOn Ltd', parent: null, attributes: { isExternal: false, vendor: 'Enzen' } }, evidence: evidence('PowerOn Ltd', { attributeConfidence: { vendor: 0.9 } }) };
    const { candidates: result } = dedupeIntraDocumentCandidates([first, dup]);
    expect(result).toHaveLength(1);
    expect((result[0]?.proposal as ElementProposal<'system'>).attributes.vendor).toBe('Enzen');
  });

  it('warns ROWS_DISAGREE rather than overwriting when both state a differing value for the same attribute', () => {
    const first: RowCandidate = { ...elementCandidate(0, 'PowerOn'), proposal: { kind: 'element', elementType: 'system', name: 'PowerOn', parent: null, attributes: { isExternal: false, vendor: 'Acme' } } };
    const dup: RowCandidate = { ...elementCandidate(1, 'PowerOn Ltd'), proposal: { kind: 'element', elementType: 'system', name: 'PowerOn Ltd', parent: null, attributes: { isExternal: false, vendor: 'Enzen' } } };
    const { candidates: result } = dedupeIntraDocumentCandidates([first, dup]);
    expect(result).toHaveLength(1);
    expect((result[0]?.proposal as ElementProposal<'system'>).attributes.vendor).toBe('Acme');
    expect(result[0]?.evidence.warnings).toContainEqual({ code: 'ROWS_DISAGREE', cell: 'A2' });
  });

  it('collects an alias proposal for every merged variant name', () => {
    const { candidates: result } = dedupeIntraDocumentCandidates([elementCandidate(0, 'PowerOn'), elementCandidate(1, 'PowerOn Ltd')]);
    const aliasValues = result[0]?.aliasProposals.map((a) => a.value);
    expect(aliasValues).toContain('PowerOn');
    expect(aliasValues).toContain('PowerOn Ltd');
  });

  it('never merges candidates of different element types even with the same name', () => {
    const system = elementCandidate(0, 'Billing');
    const container: RowCandidate = { ...elementCandidate(1, 'Billing'), proposal: { kind: 'element', elementType: 'container', name: 'Billing', parent: null, attributes: { isExternal: false } } };
    const { candidates: result } = dedupeIntraDocumentCandidates([system, container]);
    expect(result).toHaveLength(2);
  });

  it('never merges candidates with different (unresolved) parent text', () => {
    const a: RowCandidate = { ...elementCandidate(0, 'Portal'), proposal: { kind: 'element', elementType: 'container', name: 'Portal', parent: { kind: 'unresolved', text: 'SAP' }, attributes: { isExternal: false } } };
    const b: RowCandidate = { ...elementCandidate(1, 'Portal'), proposal: { kind: 'element', elementType: 'container', name: 'Portal', parent: { kind: 'unresolved', text: 'Salesforce' }, attributes: { isExternal: false } } };
    const { candidates: result } = dedupeIntraDocumentCandidates([a, b]);
    expect(result).toHaveLength(2);
  });

  it('re-points a relationship candidate whose endpoint was merged away', () => {
    const survivor = elementCandidate(0, 'PowerOn');
    const dup = elementCandidate(1, 'PowerOn Ltd');
    const ownsProposal: RelationshipProposal<'owns'> = { kind: 'relationship', relationshipType: 'owns', from: { kind: 'candidate', seq: 2 }, to: { kind: 'candidate', seq: 1 }, attributes: { role: 'business' } };
    const owns: RowCandidate = { seq: 3, proposal: ownsProposal, evidence: evidence('owns'), aliasProposals: [] };
    const { candidates: result } = dedupeIntraDocumentCandidates([survivor, dup, owns]);
    const rewired = result.find((c) => c.proposal.kind === 'relationship');
    expect(rewired?.proposal.kind).toBe('relationship');
    expect((rewired?.proposal as RelationshipProposal<'owns'>).to).toEqual({ kind: 'candidate', seq: 0 });
  });
});

describe('a value the document stated beats one it only guessed', () => {
  const actor = (seq: number, attributes: Record<string, unknown>, attributeConfidence: Record<string, number>): RowCandidate => ({
    seq,
    proposal: { kind: 'element', elementType: 'actor', name: 'Network Team', parent: null, attributes },
    evidence: evidence('Network Team', { attributeConfidence }),
    aliasProposals: [{ type: 'name', value: 'Network Team' }],
  });

  it('a defaulted subtype (0.6) yields to a stated one; two stated values still keep the first and warn', () => {
    const guessed = actor(0, { subtype: 'person', isExternal: false }, { subtype: 0.6, isExternal: 0.6 });
    const stated = actor(1, { subtype: 'team', isExternal: false }, { subtype: 0.95, isExternal: 0.95 });
    const { candidates } = dedupeIntraDocumentCandidates([guessed, stated].map((c) => ({ ...c, proposal: { ...(c.proposal as ElementProposal<'actor'>), name: c.seq === 0 ? 'Network Team' : 'Network Team Ltd' } })));
    expect((candidates[0]?.proposal as ElementProposal<'actor'>).attributes.subtype).toBe('team');
    expect(candidates[0]?.evidence.warnings).toEqual([]);

    const firstStated = actor(0, { subtype: 'person' }, { subtype: 0.95 });
    const secondStated = actor(1, { subtype: 'team' }, { subtype: 0.95 });
    const merged = mergeSameNamedActors([firstStated, secondStated]).candidates;
    expect((merged[0]?.proposal as ElementProposal<'actor'>).attributes.subtype).toBe('person');
    expect(merged[0]?.evidence.warnings).toContainEqual({ code: 'ROWS_DISAGREE', cell: 'A2' });
  });
});

describe('mergeSameNamedActors', () => {
  const actorNamed = (seq: number, name: string, attributes: Record<string, unknown>, attributeConfidence: Record<string, number>): RowCandidate => ({
    seq,
    proposal: { kind: 'element', elementType: 'actor', name, parent: null, attributes },
    evidence: evidence(name, { attributeConfidence }),
    aliasProposals: [{ type: 'name', value: name }],
  });
  const owns = (seq: number, fromSeq: number): RowCandidate => ({
    seq,
    proposal: { kind: 'relationship', relationshipType: 'owns', from: { kind: 'candidate', seq: fromSeq }, to: { kind: 'candidate', seq: 0 }, attributes: { role: 'business' } },
    evidence: evidence('owns'),
    aliasProposals: [],
  });

  it('merges an owner-cell actor and an Actors-sheet row of the same name into one, with the stated type, and re-points the owns edge', () => {
    const system = elementCandidate(0, 'Aurora');
    const ownerCellActor = actorNamed(1, 'Network Team', { subtype: 'person', isExternal: false }, { subtype: 0.6, isExternal: 0.6 });
    const edge = owns(2, 1);
    const sheetActor = actorNamed(3, 'network  team', { subtype: 'team', isExternal: false }, { subtype: 0.95, isExternal: 0.95 });
    const { candidates, seqRemap } = mergeSameNamedActors([system, ownerCellActor, edge, sheetActor]);

    expect(candidates.filter((c) => c.proposal.kind === 'element' && c.proposal.elementType === 'actor')).toHaveLength(1);
    expect(seqRemap.get(3)).toBe(1);
    const survivor = candidates.find((c) => c.seq === 1);
    expect((survivor?.proposal as ElementProposal<'actor'>).attributes.subtype).toBe('team');
    expect(survivor?.aliasProposals.map((a) => a.value)).toEqual(['Network Team', 'network  team']);
  });

  it('leaves differently named actors, and every non-actor, alone — even two near-identical systems', () => {
    const list = [actorNamed(0, 'Network Team', {}, {}), actorNamed(1, 'Network Teams', {}, {}), elementCandidate(2, 'CBRM'), elementCandidate(3, 'CBRM (legacy)')];
    const { candidates, seqRemap } = mergeSameNamedActors(list);
    expect(candidates).toHaveLength(4);
    expect(seqRemap.size).toBe(0);
  });
});
