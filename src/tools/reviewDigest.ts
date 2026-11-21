/** The reviewer's explicit data boundary. Only these saved fields leave Atlas. */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { BranchRow, DecisionOptionRatingRow, DecisionRow } from '../db/types';
import type { WhatChangesRow } from '../engine/decisionDigest/whatChangesType';
import { buildDecisionAdrExportInput } from '../engine/decisionDigest/decisionAdrInput';
import { exportDecisionAsAdrMarkdown } from '../engine/decisionDigest/exportDecisionAsAdr';
import { intentHeaderLine } from '../engine/decisionDigest/intentHeaderLine';
import type { DecisionLinkRow } from '../db/types';
import type { ModelSnapshot } from './types';

export interface ReviewDigestInput {
  decision: DecisionRow;
  links: readonly DecisionLinkRow[];
  options: readonly BranchRow[];
  ratings: readonly Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'>[];
  concerns: readonly ElementsHeadRow[];
  concernRelationships?: readonly RelationshipsHeadRow[];
  snapshot: ModelSnapshot;
  principles: readonly { title: string; stance: 'follows' | 'departs'; reason: string }[];
  goals: readonly string[];
  whatChangesRows: readonly WhatChangesRow[];
  shareCost: boolean;
}

export interface ReviewDigest {
  text: string;
  /** Used only on the server to associate a generated label with an option. */
  optionIdsByLabel: ReadonlyMap<string, string>;
  elementIdsByLabel: ReadonlyMap<string, string>;
  containsMoneyText: boolean;
}

const MONEY = /(?:[$£€]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:GBP|USD|EUR|pounds?|dollars?|euros?)\b)/i;

function elementLine(element: ElementsHeadRow): string {
  const attrs = (element.attributes && typeof element.attributes === 'object' && !Array.isArray(element.attributes) ? element.attributes : {}) as Record<string, unknown>;
  // Explicit, small allowlist; never spread attributes (run cost and future money fields are excluded).
  const permitted = ['isExternal', 'externalOrganisation', 'hostingModel', 'hostingProvider', 'criticality', 'supportEndsAt', 'lifecycleStatus', 'domain', 'aiAutonomy', 'aiUse'];
  const facts = permitted.flatMap((key) => {
    const value = attrs[key];
    return typeof value === 'string' || typeof value === 'boolean' ? [`${key}: ${String(value)}`] : [];
  });
  return `${element.name} (${element.element_type})${facts.length ? ` — ${facts.join('; ')}` : ''}`;
}

function relationLine(edge: RelationshipsHeadRow, names: ReadonlyMap<string, string>): string {
  const attrs = (edge.attributes && typeof edge.attributes === 'object' && !Array.isArray(edge.attributes) ? edge.attributes : {}) as Record<string, unknown>;
  const classification = typeof attrs.dataClassification === 'string' ? ` (recorded data classification: ${attrs.dataClassification})` : '';
  return `${names.get(edge.from_element_id) ?? 'Unknown'} ${edge.relationship_type} ${names.get(edge.to_element_id) ?? 'Unknown'}${classification}`;
}

export function buildReviewerDigest(input: ReviewDigestInput): ReviewDigest {
  const { decision, options, concerns, ratings, snapshot, shareCost } = input;
  // Build an explicit copy: a future field on DecisionRow/BranchRow does not
  // leave Atlas simply because the human pack starts rendering it.
  const safeDecision = {
    title: decision.title, statement: decision.statement, status: decision.status,
    needed_by: decision.needed_by, branch_id: decision.branch_id,
    reconsider_if: decision.reconsider_if, review_by: decision.review_by,
    stay_risk: '', stay_reason: '', lens_map_url: null,
    ai_draft_agent: null, ai_drafted_at: null, ai_draft_edited: false,
    decided_at: null, cancel_reason: null,
  } as DecisionRow;
  const safeOptions = options.map((option) => ({
    id: option.id, name: option.name, title: option.title,
    description: option.description, status: option.status, intent: option.intent,
  } as BranchRow));
  const visibleRows = input.whatChangesRows.filter((r) => r.anyChanged && (shareCost || r.id !== 'run-cost'));
  const adrInput = buildDecisionAdrExportInput({
    decision: safeDecision,
    links: input.links,
    linkedElementsById: new Map(concerns.map((e) => [e.element_id, e])),
    linkedBranchesById: new Map(safeOptions.map((b) => [b.id, b])),
    args: [], ratings: ratings.filter((r) => shareCost || r.criterion !== 'cost'),
    principles: input.principles, goalsServed: input.goals,
    whatChangesRows: visibleRows, ownerName: '',
  });
  const lines = [exportDecisionAsAdrMarkdown({ ...adrInput, omitOwner: true }).trimEnd()];
  const optionIdsByLabel = new Map<string, string>();
  const elementIdsByLabel = new Map<string, string>();
  const allNames = new Map(snapshot.elements.map((e) => [e.element_id, e.name]));
  lines.push('Options:');
  for (const [index, option] of options.entries()) {
    // Index makes the reference unambiguous even when two options share a title; ids stay server-side.
    const label = `Option ${String(index + 1)}: ${option.title ?? option.name}`;
    optionIdsByLabel.set(label, option.id);
    lines.push(`${label} means ${intentHeaderLine(option)}`);
  }
  const relevantIds = new Set(concerns.map((e) => e.element_id));
  for (const edge of input.concernRelationships ?? []) {
    relevantIds.add(edge.from_element_id);
    relevantIds.add(edge.to_element_id);
  }
  // Only direct estate relationships of the declared concerns, never a whole-model dump.
  const explicitRelationshipIds = new Set((input.concernRelationships ?? []).map((edge) => edge.relationship_id));
  const edges = snapshot.relationships.filter((edge) => explicitRelationshipIds.has(edge.relationship_id) || relevantIds.has(edge.from_element_id) || relevantIds.has(edge.to_element_id)).slice(0, 50);
  for (const edge of edges) {
    relevantIds.add(edge.from_element_id);
    relevantIds.add(edge.to_element_id);
  }
  lines.push('Recorded estate and concerns:');
  const shownElements = snapshot.elements.filter((e) => relevantIds.has(e.element_id)).slice(0, 100);
  const nameCounts = new Map<string, number>();
  for (const element of shownElements) nameCounts.set(element.name, (nameCounts.get(element.name) ?? 0) + 1);
  for (const element of shownElements) {
    const label = element.name;
    if (nameCounts.get(label) === 1) elementIdsByLabel.set(label, element.element_id);
    lines.push(elementLine(element));
  }
  for (const edge of edges) lines.push(relationLine(edge, allNames));
  if (input.principles.length) {
    lines.push('Principles:');
    for (const principle of input.principles) lines.push(`${principle.title}: ${principle.stance}${principle.reason ? ` — ${principle.reason}` : ''}`);
  }
  if (input.goals.length) lines.push(`Goals served: ${input.goals.join('; ')}`);
  const text = lines.join('\n');
  // This is a warning/block for visible free text, not a claim that regex can find every cost reference.
  return { text, optionIdsByLabel, elementIdsByLabel, containsMoneyText: !shareCost && MONEY.test(text) };
}
