/**
 * The one list of what an AI is never sent unless the organisation chooses
 * (Simon, 2026-11-19: "consider in all circumstances what should not be
 * shared — e.g. any cost data"). Today that is run cost. Adding a field here
 * removes it from every tool result at the source: the snapshot and the
 * facts a tool reads are cleaned once, in `createToolContext`, so no tool
 * has to remember.
 */
import type { ElementsHeadRow, FactsRow } from '../contracts/rows';
import { attributesRecord } from '../engine/elementRead/attributesRecord';
import type { ModelSnapshot } from './types';

/** Attribute keys that carry cost. A new money field joins this list by default. */
export const COST_ATTRIBUTE_KEYS: readonly string[] = ['annualRunCost'];

const COST_KEYS = new Set(COST_ATTRIBUTE_KEYS);

function withoutCostAttributes(element: ElementsHeadRow): ElementsHeadRow {
  const attributes = attributesRecord(element.attributes);
  if (!Object.keys(attributes).some((key) => COST_KEYS.has(key))) return element;
  return { ...element, attributes: Object.fromEntries(Object.entries(attributes).filter(([key]) => !COST_KEYS.has(key))) };
}

export function snapshotWithoutCost(snapshot: ModelSnapshot): ModelSnapshot {
  return { ...snapshot, elements: snapshot.elements.map(withoutCostAttributes) };
}

export function factsWithoutCost(facts: readonly FactsRow[]): FactsRow[] {
  return facts.filter((fact) => !COST_KEYS.has(fact.attribute));
}
