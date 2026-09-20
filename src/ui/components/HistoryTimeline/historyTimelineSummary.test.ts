import { describe, expect, it } from 'vitest';
import type { DeltaHistoryRow } from '../../../db/elements';
import type { DeltaRowKind } from '../../../contracts/rows';
import { buildRelationshipParticipantsById, summariseHistoryEntry, type HistorySummaryContext } from './historyTimelineSummary';

let seq = 0;
function delta(overrides: Partial<DeltaHistoryRow> & { kind: DeltaRowKind; subject_id: string }): DeltaHistoryRow {
  seq += 1;
  return {
    id: `d${String(seq)}`,
    org_id: 'org',
    model_id: 'model',
    commit_id: 'commit',
    seq,
    subject_type: 'relationship',
    attribute: 'exists',
    element_type: null,
    relationship_type: null,
    name: null,
    parent_id: null,
    from_element_id: null,
    to_element_id: null,
    value: null,
    previous_delta_id: null,
    source_id: 'source',
    source_ref: null,
    effective_date: null,
    confidence: 1,
    created_by: 'user',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const HUB = 'hub';
const CAPABILITY = 'cap-1';

function context(overrides: Partial<HistorySummaryContext> = {}): HistorySummaryContext {
  return {
    elementId: HUB,
    participants: new Map(),
    elementNamesById: new Map([[CAPABILITY, 'Smart Metering Data']]),
    ...overrides,
  };
}

describe('summariseHistoryEntry', () => {
  it('names the created element for element_create', () => {
    const d = delta({ kind: 'element_create', subject_id: HUB, subject_type: 'element', name: 'Smart Metering Data' });
    expect(summariseHistoryEntry(d, context())).toBe('created — Smart Metering Data');
  });

  it('shows a human attribute label and clean value for element_update', () => {
    const d = delta({ kind: 'element_update', subject_id: HUB, subject_type: 'element', element_type: 'system', attribute: 'lifecycleStatus', value: 'active' });
    expect(summariseHistoryEntry(d, context())).toBe('Lifecycle: active');
  });

  it('falls back to the raw key for a custom attribute with no schema entry', () => {
    const d = delta({ kind: 'element_update_custom', subject_id: HUB, subject_type: 'element', element_type: 'system', attribute: 'internalCode', value: 'X-42' });
    expect(summariseHistoryEntry(d, context())).toBe('internalCode: X-42');
  });

  it('reports element_retract/restore plainly — no ambiguity, this is the page\'s own element', () => {
    expect(summariseHistoryEntry(delta({ kind: 'element_retract', subject_id: HUB, subject_type: 'element' }), context())).toBe('retracted');
    expect(summariseHistoryEntry(delta({ kind: 'element_restore', subject_id: HUB, subject_type: 'element' }), context())).toBe('restored');
  });

  it('names the other endpoint for relationship_create — outbound', () => {
    const d = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: HUB, to_element_id: CAPABILITY });
    const participants = buildRelationshipParticipantsById([d]);
    expect(summariseHistoryEntry(d, context({ participants }))).toBe('created — supports Smart Metering Data');
  });

  it('names the other endpoint for relationship_create — inbound, using the inbound verb', () => {
    const d = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: CAPABILITY, to_element_id: HUB });
    const participants = buildRelationshipParticipantsById([d]);
    expect(summariseHistoryEntry(d, context({ participants }))).toBe('created — supported by Smart Metering Data');
  });

  it('recovers the other endpoint for relationship_retract/restore from the sibling relationship_create row', () => {
    const created = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: HUB, to_element_id: CAPABILITY });
    const retracted = delta({ kind: 'relationship_retract', subject_id: 'rel-1', relationship_type: 'supports' });
    const restored = delta({ kind: 'relationship_restore', subject_id: 'rel-1', relationship_type: 'supports' });
    const participants = buildRelationshipParticipantsById([created, retracted, restored]);
    expect(summariseHistoryEntry(retracted, context({ participants }))).toBe('retracted — supports Smart Metering Data');
    expect(summariseHistoryEntry(restored, context({ participants }))).toBe('restored — supports Smart Metering Data');
  });

  it('names the relationship attribute label, value, and other endpoint for relationship_update', () => {
    const created = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: HUB, to_element_id: CAPABILITY });
    const updated = delta({ kind: 'relationship_update', subject_id: 'rel-1', relationship_type: 'supports', attribute: 'role', value: 'primary' });
    const participants = buildRelationshipParticipantsById([created, updated]);
    expect(summariseHistoryEntry(updated, context({ participants }))).toBe('Role: primary — supports Smart Metering Data');
  });

  it('falls back to a bare verb when the sibling relationship_create row is missing (defensive)', () => {
    const retracted = delta({ kind: 'relationship_retract', subject_id: 'rel-missing', relationship_type: 'supports' });
    expect(summariseHistoryEntry(retracted, context())).toBe('retracted — supports');
  });

  it('falls back to the raw element id when the other endpoint has itself since been retracted', () => {
    const created = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: HUB, to_element_id: 'gone-id' });
    const participants = buildRelationshipParticipantsById([created]);
    expect(summariseHistoryEntry(created, context({ participants, elementNamesById: new Map() }))).toBe('created — supports gone-id');
  });
});

describe('buildRelationshipParticipantsById', () => {
  it('keys each relationship_create row by its own subject_id (the relationship id)', () => {
    const created = delta({ kind: 'relationship_create', subject_id: 'rel-1', relationship_type: 'supports', from_element_id: HUB, to_element_id: CAPABILITY });
    const map = buildRelationshipParticipantsById([created]);
    expect(map.get('rel-1')).toEqual({ fromElementId: HUB, toElementId: CAPABILITY });
  });

  it('ignores non-create rows', () => {
    const retracted = delta({ kind: 'relationship_retract', subject_id: 'rel-1', relationship_type: 'supports' });
    expect(buildRelationshipParticipantsById([retracted]).size).toBe(0);
  });
});
