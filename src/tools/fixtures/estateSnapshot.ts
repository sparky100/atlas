/**
 * Test-only: a small, fixed model for the tools' unit tests (rule 7: seed data
 * lives in test setup, never on a production path — nothing outside `*.test.ts`
 * imports this file). Ids are valid v4 UUIDs built from a number so tests can
 * name them.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ChangeSummary } from '../../db/changeSummary';
import type { OpenDecisionElementLink } from '../../db/decisions';
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import type { BranchRow, DecisionRow, ProjectRow, SavedReportRow } from '../../db/types';
import type { ModelSnapshot, ToolContext } from '../types';

export function uid(n: number): UUID {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const DELTA = uid(999999);

export function element(n: number, type: ElementsHeadRow['element_type'], name: string, attributes: Record<string, string | number | boolean> = {}, parent: number | null = null): ElementsHeadRow {
  return { element_id: uid(n), element_type: type, name, parent_id: parent === null ? null : uid(parent), attributes, exists_delta_id: DELTA };
}

export function edge(n: number, type: RelationshipsHeadRow['relationship_type'], from: number, to: number, attributes: Record<string, string | number | boolean> = {}): RelationshipsHeadRow {
  return { relationship_id: uid(n), relationship_type: type, from_element_id: uid(from), to_element_id: uid(to), attributes, exists_delta_id: DELTA };
}

/** Ids: capabilities 1-2, systems 10-13, actors 20-21, module 14 (of system 10). */
export const ESTATE_ELEMENTS: ElementsHeadRow[] = [
  element(1, 'capability', 'Customer Onboarding'),
  element(2, 'capability', 'Billing'),
  element(10, 'system', 'CRM Platform', { lifecycleStatus: 'active', criticality: 'high', supportEndsAt: '2027-06-30' }),
  element(11, 'system', 'Billing Engine', { lifecycleStatus: 'active', criticality: 'critical', supportEndsAt: '2026-12-31' }),
  element(12, 'system', 'Legacy Portal', { lifecycleStatus: 'retiring', criticality: 'low', supportEndsAt: '2029-01-01' }),
  element(13, 'system', 'Data Warehouse', { lifecycleStatus: 'active', criticality: 'medium' }),
  element(14, 'container', 'Onboarding Module', { lifecycleStatus: 'active' }, 10),
  element(20, 'actor', 'Ada Lovelace'),
  element(21, 'actor', 'Grace Hopper'),
];

export const ESTATE_RELATIONSHIPS: RelationshipsHeadRow[] = [
  edge(100, 'supports', 10, 1),
  edge(101, 'supports', 12, 1),
  edge(102, 'supports', 11, 2),
  edge(103, 'owns', 20, 10, { role: 'business' }),
  edge(104, 'owns', 21, 11, { role: 'business' }),
  edge(105, 'uses', 10, 13),
  edge(106, 'uses', 11, 13),
];

export function estateSnapshot(extra: { elements?: ElementsHeadRow[]; relationships?: RelationshipsHeadRow[]; aliases?: [number, string[]][] } = {}): ModelSnapshot {
  return {
    elements: [...ESTATE_ELEMENTS, ...(extra.elements ?? [])],
    relationships: [...ESTATE_RELATIONSHIPS, ...(extra.relationships ?? [])],
    aliases: new Map((extra.aliases ?? [[10, ['Customer Relationship Manager']]]).map(([n, a]) => [uid(n), a])),
  };
}

export function savedReport(n: number, name: string, spec: unknown): SavedReportRow {
  return { id: uid(n), org_id: uid(900), model_id: uid(901), name, description: `${name} (test)`, spec: spec as SavedReportRow['spec'], spec_version: 1, visibility: 'private', created_by: uid(902), created_at: '', updated_at: '' };
}

export const FIXTURE_NOW = new Date('2026-11-06T12:00:00Z');

export function estateContext(over: { snapshot?: ModelSnapshot; facts?: FactsRow[]; reports?: SavedReportRow[]; retired?: UUID[]; changes?: BranchRow[]; decisions?: DecisionRow[]; decisionLinks?: OpenDecisionElementLink[]; projects?: ProjectRow[]; goals?: GoalRow[]; goalLinks?: GoalCapabilityRow[]; impact?: Record<string, ChangeSummary | null> } = {}): ToolContext {
  const snapshot = over.snapshot ?? estateSnapshot();
  return {
    stamp: { modelId: uid(901), modelName: 'Test estate', ref: 'main', commitId: uid(903) },
    snapshot: () => Promise.resolve(snapshot),
    factsFor: (elementId) => Promise.resolve((over.facts ?? []).filter((f) => f.subject_id === elementId)),
    savedReports: () => Promise.resolve(over.reports ?? []),
    allFacts: () => Promise.resolve(over.facts ?? []),
    staleAfterMonths: () => Promise.resolve(12),
    retiredByOpenChanges: () => Promise.resolve(new Set(over.retired ?? [])),
    changes: () => Promise.resolve(over.changes ?? []),
    decisions: () => Promise.resolve(over.decisions ?? []),
    openDecisionLinks: () => Promise.resolve(over.decisionLinks ?? []),
    projects: () => Promise.resolve(over.projects ?? []),
    goals: () => Promise.resolve(over.goals ?? []),
    goalLinks: () => Promise.resolve(over.goalLinks ?? []),
    changeImpact: (change) => Promise.resolve(over.impact?.[change.id] ?? null),
    now: () => FIXTURE_NOW,
  };
}
