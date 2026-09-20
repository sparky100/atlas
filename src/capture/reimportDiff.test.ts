import { describe, expect, it } from 'vitest';
import type { CandidateDecision, CandidateEvidence, CandidateProposal } from '../contracts/capture';
import type { ElementsHeadRow } from '../contracts/rows';
import { buildMatchIndex } from './matchIndex';
import { diffAgainstPreviousImport, type PreviousCandidateForDiff, type ThisRunCandidateForDiff } from './reimportDiff';

function elementsHead(overrides: Partial<ElementsHeadRow> = {}): ElementsHeadRow {
  return { element_id: 'el-1', element_type: 'system', name: 'CRM', parent_id: null, attributes: {}, exists_delta_id: 'd-1', ...overrides };
}

function evidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { sourceRef: { kind: 'sheet', sheet: 'Sheet1', range: 'B2' }, passage: 'CRM | Acme', extractor: 'sheet-mapping', attributeConfidence: {}, warnings: [], ...overrides };
}

function elementProposal(name: string, attributes: Record<string, unknown> = {}): CandidateProposal {
  return { kind: 'element', elementType: 'system', name, parent: null, attributes };
}

function previous(overrides: Partial<PreviousCandidateForDiff> & { rowKey: string }): PreviousCandidateForDiff {
  return { kind: 'element', elementType: 'system', relationshipType: null, proposal: elementProposal('CRM', { vendor: 'Acme' }), evidence: evidence(), decision: 'accepted', ...overrides };
}

function thisRun(rowKey: string, proposal: CandidateProposal): ThisRunCandidateForDiff {
  return { rowKey, proposal };
}

const EMPTY_INDEX = buildMatchIndex([], []);

describe('diffAgainstPreviousImport — reimportStatus for this run\'s own candidates', () => {
  it("'new' when no previous row shares this key", () => {
    const result = diffAgainstPreviousImport([thisRun('name:system:crm:', elementProposal('CRM'))], [], EMPTY_INDEX);
    expect(result.reimportStatusByRowKey.get('name:system:crm:')).toBe('new');
  });

  it("'changed' when a previous row shares the key but an attribute value differs", () => {
    const result = diffAgainstPreviousImport([thisRun('name:system:crm:', elementProposal('CRM', { vendor: 'Northgate' }))], [previous({ rowKey: 'name:system:crm:', proposal: elementProposal('CRM', { vendor: 'Acme' }) })], EMPTY_INDEX);
    expect(result.reimportStatusByRowKey.get('name:system:crm:')).toBe('changed');
  });

  it("'unchanged' when a previous row shares the key and every attribute value is the same", () => {
    const result = diffAgainstPreviousImport([thisRun('name:system:crm:', elementProposal('CRM', { vendor: 'Acme' }))], [previous({ rowKey: 'name:system:crm:', proposal: elementProposal('CRM', { vendor: 'Acme' }) })], EMPTY_INDEX);
    expect(result.reimportStatusByRowKey.get('name:system:crm:')).toBe('unchanged');
  });

  it('is decided independently per candidate, not globally', () => {
    const result = diffAgainstPreviousImport(
      [thisRun('a', elementProposal('A', { vendor: 'X' })), thisRun('b', elementProposal('B', { vendor: 'Y' }))],
      [previous({ rowKey: 'a', proposal: elementProposal('A', { vendor: 'X' }) })],
      EMPTY_INDEX,
    );
    expect(result.reimportStatusByRowKey.get('a')).toBe('unchanged');
    expect(result.reimportStatusByRowKey.get('b')).toBe('new');
  });
});

describe('diffAgainstPreviousImport — gone candidates (K-14)', () => {
  const matchIndex = buildMatchIndex([elementsHead({ element_id: 'sys-1', element_type: 'system', name: 'CRM' })], []);

  it('produces a gone candidate for a previously accepted row that vanished and still matches main', () => {
    const result = diffAgainstPreviousImport([], [previous({ rowKey: 'name:system:crm:', decision: 'accepted' })], matchIndex);
    expect(result.goneCandidates).toHaveLength(1);
    expect(result.goneCandidates[0]).toMatchObject({ rowKey: 'name:system:crm:', elementType: 'system', match: { elementId: 'sys-1' }, evidence: { extractor: 'reimport-diff' } });
  });

  it.each<CandidateDecision | null>(['rejected', null])('never produces a gone candidate when the previous decision was %s', (decision) => {
    const result = diffAgainstPreviousImport([], [previous({ rowKey: 'name:system:crm:', decision })], matchIndex);
    expect(result.goneCandidates).toEqual([]);
  });

  it.each<CandidateDecision>(['merged', 'edited'])('also produces one when the previous decision was %s', (decision) => {
    const result = diffAgainstPreviousImport([], [previous({ rowKey: 'name:system:crm:', decision })], matchIndex);
    expect(result.goneCandidates).toHaveLength(1);
  });

  it('produces nothing when the row is still present this run', () => {
    const result = diffAgainstPreviousImport([thisRun('name:system:crm:', elementProposal('CRM'))], [previous({ rowKey: 'name:system:crm:' })], matchIndex);
    expect(result.goneCandidates).toEqual([]);
  });

  it('produces nothing when nothing on main matches anymore (retracted/renamed past recognition)', () => {
    const result = diffAgainstPreviousImport([], [previous({ rowKey: 'name:system:crm:', proposal: elementProposal('Something Entirely Different') })], matchIndex);
    expect(result.goneCandidates).toEqual([]);
  });

  it('never produces one for a relationship candidate — §4.4: gone is element-only', () => {
    const relProposal: CandidateProposal = { kind: 'relationship', relationshipType: 'supports', from: { kind: 'existing', elementId: 'sys-1' }, to: { kind: 'existing', elementId: 'cap-1' }, attributes: { role: 'secondary' } };
    const result = diffAgainstPreviousImport([], [previous({ rowKey: 'rel:supports:a→b', kind: 'relationship', elementType: null, relationshipType: 'supports', proposal: relProposal })], matchIndex);
    expect(result.goneCandidates).toEqual([]);
  });
});
