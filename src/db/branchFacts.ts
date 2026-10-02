/**
 * Current facts for one subject at an arbitrary branch's head (Sprint C1
 * step 4). `main`'s current head (and any tag) is materialised
 * (`facts`, SPEC §3.5) — `listFactsForSubject` is the cheap path every
 * pre-Sprint-C1 read already used. A `change` branch's head is never
 * materialised at all, at any point in its life (ADR-015, SPEC §1 S-2):
 * the only way to know "what does this element's `name` currently say, and
 * which delta asserted it" there is a full fold via the engine.
 *
 * This is what the commit-writing hooks
 * (src/ui/elements/useElementEditor.ts, useElementRename.ts,
 * useElementRetire.ts, useElementRemoveFromModel.ts,
 * src/ui/capabilityMap/useCapabilityCreate.ts) call
 * to find each field's current `previousDeltaId` before building a delta —
 * they need this regardless of which branch they're writing to, since even
 * an edit at main has always needed "the fact this update supersedes."
 * Returns the same `Map<string, FactsRow>` shape those hooks (and
 * src/ui/elements/useElementPage.ts) already consume, so nothing else
 * about their logic has to change — only where the map comes from.
 */
import type { SubjectType, UUID } from '../contracts/delta';
import type { FactsRow } from '../contracts/rows';
import type { FactRow, Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import { buildCommitLoader } from './commitLoader';
import type { Client } from './client';
import { listFactsForAttribute, listFactsForSubject } from './elements';
import type { BranchRow } from './types';

/** Exported for direct unit testing — the one pure part of this module (no database). */
export function factsRowsFromHead(head: Head, subjectType: SubjectType, subjectId: UUID): Map<string, FactsRow> {
  const result = new Map<string, FactsRow>();
  for (const fact of head.facts.values()) {
    if (fact.subjectId !== subjectId) continue;
    result.set(fact.attribute, factsRowOf(fact, subjectType));
  }
  return result;
}

function factsRowOf(fact: FactRow, subjectType: SubjectType): FactsRow {
  return {
    subject_type: subjectType,
    subject_id: fact.subjectId,
    attribute: fact.attribute,
    value: fact.value,
    delta_id: fact.deltaId,
    source_id: fact.sourceId,
    source_ref: fact.sourceRef ?? null,
    effective_date: fact.effectiveDate ?? null,
    confidence: fact.confidence,
    asserted_by: fact.authorId,
    asserted_at: fact.createdAt,
  };
}

/** Exported for direct unit testing: every element fact for one of `attributes` in a folded head, grouped by subject. */
export function attributeFactsFromHead(head: Head, attributes: ReadonlySet<string>): Map<UUID, Map<string, FactsRow>> {
  const result = new Map<UUID, Map<string, FactsRow>>();
  for (const fact of head.facts.values()) {
    if (!attributes.has(fact.attribute) || !head.elements.has(fact.subjectId)) continue;
    let bySubject = result.get(fact.subjectId);
    if (!bySubject) {
      bySubject = new Map();
      result.set(fact.subjectId, bySubject);
    }
    bySubject.set(fact.attribute, factsRowOf(fact, 'element'));
  }
  return result;
}

/**
 * F12 step 1: the current facts for a handful of attributes across every
 * element at `branch`'s head — what a grid save needs for each edited
 * cell's `previousDeltaId`. Scoped by commit and attribute (one query per
 * attribute at main, `listFactsForAttribute`), never by an element-id
 * list, so it stays inside rule 8 however many rows were edited; a change
 * branch has no materialised facts, so it folds once.
 */
export async function loadAttributeFactsAtBranch(
  supabase: Client,
  modelId: UUID,
  branch: BranchRow,
  attributes: readonly string[],
): Promise<Map<UUID, Map<string, FactsRow>>> {
  if (branch.kind === 'main') {
    const result = new Map<UUID, Map<string, FactsRow>>();
    for (const attribute of new Set(attributes)) {
      for (const row of await listFactsForAttribute(supabase, branch.head_commit_id, attribute)) {
        let bySubject = result.get(row.subject_id);
        if (!bySubject) {
          bySubject = new Map();
          result.set(row.subject_id, bySubject);
        }
        bySubject.set(row.attribute, row);
      }
    }
    return result;
  }
  const loader = await buildCommitLoader(supabase, modelId);
  return attributeFactsFromHead(foldFromGenesis(branch.head_commit_id, loader), new Set(attributes));
}

export async function loadFactsForSubjectAtBranch(
  supabase: Client,
  modelId: UUID,
  branch: BranchRow,
  subjectType: SubjectType,
  subjectId: UUID,
): Promise<Map<string, FactsRow>> {
  if (branch.kind === 'main') {
    const rows = await listFactsForSubject(supabase, branch.head_commit_id, subjectId);
    return new Map(rows.map((row) => [row.attribute, row]));
  }
  const loader = await buildCommitLoader(supabase, modelId);
  const head = foldFromGenesis(branch.head_commit_id, loader);
  return factsRowsFromHead(head, subjectType, subjectId);
}
