/** The reviewer's explicit data boundary. Only these saved fields leave Atlas. */
import { decisionCriterionLevelLabel, DECISION_CRITERIA } from '../contracts/decisionCriteria';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import type { BranchRow, DecisionOptionRatingRow, DecisionRow } from '../db/types';
import type { ModelSnapshot } from './types';

export interface ReviewDigestInput {
  decision: Pick<DecisionRow, 'title' | 'statement' | 'status' | 'needed_by' | 'branch_id' | 'reconsider_if' | 'review_by'>;
  options: readonly Pick<BranchRow, 'id' | 'title' | 'name' | 'description'>[];
  ratings: readonly Pick<DecisionOptionRatingRow, 'branch_id' | 'criterion' | 'level' | 'note'>[];
  concerns: readonly ElementsHeadRow[];
  concernRelationships?: readonly RelationshipsHeadRow[];
  snapshot: ModelSnapshot;
  principles: readonly { title: string; stance: 'follows' | 'departs'; reason: string }[];
  goals: readonly string[];
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
  const lines = [`# Decision: ${decision.title}`, `Status: ${decision.status}`, `Context: ${decision.statement}`];
  if (decision.needed_by) lines.push(`Needed by: ${decision.needed_by}`);
  if (decision.reconsider_if) lines.push(`Reconsider if: ${decision.reconsider_if}`);
  if (decision.review_by) lines.push(`Review by: ${decision.review_by}`);
  const optionIdsByLabel = new Map<string, string>();
  const elementIdsByLabel = new Map<string, string>();
  const allNames = new Map(snapshot.elements.map((e) => [e.element_id, e.name]));
  lines.push('Options:');
  for (const [index, option] of options.entries()) {
    // Index makes the reference unambiguous even when two options share a title; ids stay server-side.
    const label = `Option ${String(index + 1)}: ${option.title ?? option.name}`;
    optionIdsByLabel.set(label, option.id);
    lines.push(`${label}${option.id === decision.branch_id ? ' (chosen)' : ''}`);
    if (option.description) lines.push(`About: ${option.description}`);
    for (const criterion of DECISION_CRITERIA) {
      if (!shareCost && criterion.key === 'cost') continue;
      const rating = ratings.find((r) => r.branch_id === option.id && r.criterion === criterion.key);
      if (rating) lines.push(`${criterion.label}: ${decisionCriterionLevelLabel(criterion.key, rating.level) ?? rating.level}${rating.note ? ` — ${rating.note}` : ''}`);
    }
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
