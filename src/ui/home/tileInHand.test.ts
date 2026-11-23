import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import type { DecisionRow } from '../../db/types';
import { computeTileInHand, isNothingInHand } from './tileInHand';

function capability(id: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: id, parent_id: parentId, attributes: {}, exists_delta_id: `delta-${id}` };
}

function system(id: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name: id, parent_id: null, attributes: {}, exists_delta_id: `delta-${id}` };
}

function tile(id: string, overrides: Partial<CapabilityTileData> = {}): CapabilityTileData {
  return {
    capability: capability(id),
    supportingSystems: [],
    exposedSystems: [],
    tone: 'warn',
    supportedCapabilityCount: 0,
    totalCapabilityCount: 0,
    isOwned: false,
    fitForPurpose: null,
    weakFitCapabilities: [],
    adequateFitCount: 0,
    weakFitAllReplacementPlanned: false,
    importance: null,
    ...overrides,
  };
}

function decision(id: string, overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id,
    org_id: 'o',
    model_id: 'm',
    title: `Decision ${id}`,
    statement: '',
    status: 'proposed',
    owner_id: 'u',
    needed_by: null,
    source_finding_key: null,
    ai_draft_agent: null,
    ai_drafted_at: null,
    ai_draft_edited: false,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    cancel_reason: null,
    reconsider_if: null, review_by: null, stay_risk: '', stay_reason: '', baseline_option_id: null, baseline_branch_id: null, branch_id: null,
    superseded_decision_id: null,
    project_id: null,
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

// Revenues (L1) > Billing (L2) > Invoicing (L3); Waste (L1) on its own.
const CAPABILITIES = [capability('revenues'), capability('billing', 'revenues'), capability('invoicing', 'billing'), capability('waste')];

describe('computeTileInHand', () => {
  it('names a project scoped to the tile, or to any capability beneath it, on that tile only', () => {
    const tiles = [tile('revenues'), tile('waste')];
    const result = computeTileInHand(tiles, CAPABILITIES, [{ elementId: 'invoicing', projectId: 'p1', projectTitle: 'Revenues replacement' }], [], []);
    expect(result.get('revenues')?.projects).toEqual([{ id: 'p1', title: 'Revenues replacement' }]);
    expect(isNothingInHand(result.get('waste') ?? { projects: [], decisions: [] })).toBe(true);
  });

  it("names a project scoped to a system the tile is exposed by, but not one scoped to a merely supporting system", () => {
    const northgate = system('northgate');
    const sap = system('sap');
    const tiles = [tile('revenues', { exposedSystems: [northgate], supportingSystems: [northgate, sap] })];
    const result = computeTileInHand(
      tiles,
      CAPABILITIES,
      [
        { elementId: 'northgate', projectId: 'p-replace', projectTitle: 'Replace Northgate' },
        { elementId: 'sap', projectId: 'p-sap', projectTitle: 'SAP upgrade' },
      ],
      [],
      [],
    );
    expect(result.get('revenues')?.projects.map((p) => p.id)).toEqual(['p-replace']);
  });

  it('names an open decision linked to the tile; a decided or cancelled one never', () => {
    const tiles = [tile('revenues')];
    const decisions = [decision('d-open', { title: 'Replace or upgrade?' }), decision('d-done', { status: 'accepted' }), decision('d-cancelled', { status: 'rejected' })];
    const links = [
      { decisionId: 'd-open', elementId: 'billing' },
      { decisionId: 'd-done', elementId: 'revenues' },
      { decisionId: 'd-cancelled', elementId: 'revenues' },
    ];
    expect(computeTileInHand(tiles, CAPABILITIES, [], links, decisions).get('revenues')?.decisions).toEqual([{ id: 'd-open', title: 'Replace or upgrade?' }]);
  });

  it("shows a decision that belongs to a project already named on the tile through that project, not twice", () => {
    const tiles = [tile('revenues')];
    const decisions = [decision('d-in-project', { project_id: 'p1' }), decision('d-elsewhere', { project_id: 'p-other' })];
    const result = computeTileInHand(
      tiles,
      CAPABILITIES,
      [{ elementId: 'revenues', projectId: 'p1', projectTitle: 'Revenues replacement' }],
      [
        { decisionId: 'd-in-project', elementId: 'revenues' },
        { decisionId: 'd-elsewhere', elementId: 'revenues' },
      ],
      decisions,
    );
    expect(result.get('revenues')?.projects.map((p) => p.id)).toEqual(['p1']);
    expect(result.get('revenues')?.decisions.map((d) => d.id)).toEqual(['d-elsewhere']);
  });

  it('names a project once however many of its scope links fall on the same tile', () => {
    const tiles = [tile('revenues')];
    const scope = [
      { elementId: 'revenues', projectId: 'p1', projectTitle: 'Revenues replacement' },
      { elementId: 'billing', projectId: 'p1', projectTitle: 'Revenues replacement' },
    ];
    expect(computeTileInHand(tiles, CAPABILITIES, scope, [], []).get('revenues')?.projects).toHaveLength(1);
  });

  it('every tile gets an entry — nothing in hand when nothing names it', () => {
    const result = computeTileInHand([tile('revenues'), tile('waste')], CAPABILITIES, [], [], []);
    expect([...result.keys()].sort()).toEqual(['revenues', 'waste']);
    for (const inHand of result.values()) expect(isNothingInHand(inHand)).toBe(true);
  });
});
