import { describe, expect, it } from 'vitest';
import type { CandidateEvidence, ElementProposal, RelationshipProposal } from '../contracts/capture';
import { dedupeIntraDocumentCandidates } from './intraDocumentDedup';
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
