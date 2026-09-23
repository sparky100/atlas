/**
 * F2 (full K1), SPEC-capture.md §6.3/§7: resolves a system row's own raw
 * capability-column text (`rowsToCandidates.ts`'s own `capabilityRows`,
 * PR5) into `supports` candidates. Two passes, first hit wins, per row:
 *
 * 1. §7's own alias/name match against the model's capabilities — but
 *    unlike element-to-element matching (`match.ts`), a capability
 *    *assignment* searches the whole tree regardless of level/parent
 *    (§6.3: "the single most specific capability... from the tree", not
 *    one already-known parent's own children), so this reuses `match.ts`'s
 *    own `resolveByTrigram` directly against every capability, never
 *    `matchElement`'s own context-filtered pool.
 * 2. Only for what pass 1 leaves unresolved or ambiguous: prompt C
 *    (§6.3), batched ≤ 50 rows per call. The tree given to the model is
 *    keyed by a per-run code derived from each capability's own element
 *    id (§6.3: "never the starter map's own template code") — built and
 *    resolved back to real ids entirely inside this module; `prompts/c.ts`
 *    itself has no notion of a real element id at all.
 *
 * Every resolved target becomes a `supports` candidate whose `to` is
 * already `{kind:'existing', elementId}` — a capability assignment always
 * targets *main's* own tree, never another candidate in this run (unlike
 * `uses`/`flows_to`, which may point at a system this same sheet also
 * creates). `supports` proposals default to `role: 'secondary'` (K-13);
 * a row's own first/only capability edge is promoted to `primary` here,
 * against `mainHead`'s own live-primary state for that target — checked
 * the same way the engine's own C17 cardinality guard does
 * (`checkPrimaryCardinality`, `src/engine/deltas.ts`), just read-only.
 * `eligibleForPrimary` on the per-row summary says "this is the sole
 * capability edge this row itself proposed" — necessary for promotion,
 * not sufficient; the live-primary check above is the other half.
 */
import { z } from 'zod';
import type { CandidateEvidence, RelationshipProposal } from '../contracts/capture';
import type { UUID } from '../contracts/delta';
import type { Head } from '../engine/deltas';
import type { ElementsHeadRow } from '../contracts/rows';
import type { LlmClient } from './llm/client';
import { resolveByTrigram } from './match';
import type { MatchIndex } from './matchIndex';
import { normaliseName } from './normalise';
import { buildPromptCCapabilityTreeBlock, buildPromptCUserMessage, PROMPT_C_SCHEMA, PROMPT_C_SYSTEM, type PromptCCapabilityTreeEntry, type PromptCRow } from './prompts/c';
import type { CapabilityColumnRow, RowCandidate } from './rowsToCandidates';

/** §6: "Effort: prompt A `medium`, prompt B `high`, prompt C `medium`." */
const PROMPT_C_EFFORT = 'medium';
/** §6.3: "one per batch of ≤ 50 rows." */
const PROMPT_C_BATCH_SIZE = 50;
/** §6.3: "below 0.5, answer none instead" is the model's own instruction; a code below this floor is dropped defensively too, the same "never trust a low-confidence guess silently" stance §5.5 takes elsewhere. */
const PROMPT_C_MIN_CONFIDENCE = 0.5;

const promptCResponseSchema = z.object({
  assignments: z.array(
    z.object({
      seq: z.number(),
      capabilities: z.array(z.object({ code: z.string(), confidence: z.number().min(0).max(1) })),
    }),
  ),
});

export class CapabilityAssignmentError extends Error {}

export interface CapabilityTarget {
  elementId: UUID;
  /** §6.3: "confidence min(0.90, model confidence)" for a prompt-C hit; 1.0 for an alias hit; the trigram score itself for a name match. */
  confidence: number;
  /** Which pass resolved this target — decides the resulting candidate's own `evidence.extractor`. */
  source: 'alias' | 'trigram' | 'llm';
}

export interface CapabilityAssignment {
  seq: number;
  /** Most specific first (§6.3) — empty when nothing resolved, never a guess. */
  capabilities: CapabilityTarget[];
  /** True only when this row proposed exactly one capability edge — necessary, not sufficient, for the orchestrator's own primary-promotion decision (K-13). */
  eligibleForPrimary: boolean;
}

function elementDescription(el: ElementsHeadRow): string | undefined {
  const attrs = el.attributes;
  if (typeof attrs !== 'object' || attrs === null || Array.isArray(attrs)) return undefined;
  const value = (attrs as Record<string, unknown>).description;
  return typeof value === 'string' ? value : undefined;
}

/** Builds §6.3's own tree text plus the per-run code↔elementId mapping, in a stable order (rule 6: deterministic given the same inputs). */
function buildCapabilityTree(capabilityPool: readonly ElementsHeadRow[]): { tree: PromptCCapabilityTreeEntry[]; codeToElementId: ReadonlyMap<string, UUID> } {
  const sorted = [...capabilityPool].sort((a, b) => a.element_id.localeCompare(b.element_id));
  const codeByElementId = new Map<UUID, string>(sorted.map((el, i) => [el.element_id, `C${String(i + 1)}`]));
  const codeToElementId = new Map<string, UUID>([...codeByElementId.entries()].map(([elementId, code]) => [code, elementId]));

  const tree: PromptCCapabilityTreeEntry[] = sorted.map((el) => {
    const code = codeByElementId.get(el.element_id);
    if (code === undefined) throw new CapabilityAssignmentError('buildCapabilityTree: internal — every sorted element must have a code.');
    const parentCode = el.parent_id !== null ? (codeByElementId.get(el.parent_id) ?? null) : null;
    const desc = elementDescription(el);
    return { code, name: el.name, parentCode, ...(desc !== undefined ? { description: desc } : {}) };
  });

  return { tree, codeToElementId };
}

async function assignViaPromptC(rows: readonly CapabilityColumnRow[], tree: readonly PromptCCapabilityTreeEntry[], codeToElementId: ReadonlyMap<string, UUID>, llmClient: LlmClient): Promise<Map<number, CapabilityTarget[]>> {
  const results = new Map<number, CapabilityTarget[]>();
  const treeBlock = buildPromptCCapabilityTreeBlock(tree);

  for (let i = 0; i < rows.length; i += PROMPT_C_BATCH_SIZE) {
    const batch = rows.slice(i, i + PROMPT_C_BATCH_SIZE);
    const promptRows: PromptCRow[] = batch.map((row) => ({ seq: row.seq, systemName: row.systemName, capabilityColumnText: row.capabilityText, ...(row.description !== undefined ? { description: row.description } : {}) }));

    const response = await llmClient.complete({
      effort: PROMPT_C_EFFORT,
      system: `${PROMPT_C_SYSTEM}\n\n${treeBlock}`,
      format: { type: 'json_schema', schema: PROMPT_C_SCHEMA },
      messages: [{ role: 'user', content: buildPromptCUserMessage(promptRows) }],
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch (e) {
      throw new CapabilityAssignmentError(`Prompt C response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const result = promptCResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new CapabilityAssignmentError(`Prompt C response failed schema validation: ${result.error.message}`);
    }

    for (const assignment of result.data.assignments) {
      const targets: CapabilityTarget[] = [];
      for (const capability of assignment.capabilities) {
        const elementId = codeToElementId.get(capability.code);
        // CAPABILITY_CODE_UNKNOWN (§11): the model returned a code not in the tree we gave it — dropped, never guessed at.
        if (elementId === undefined) continue;
        if (capability.confidence < PROMPT_C_MIN_CONFIDENCE) continue;
        targets.push({ elementId, confidence: Math.min(0.9, capability.confidence), source: 'llm' });
      }
      results.set(assignment.seq, targets);
    }
  }

  return results;
}

export interface AssignCapabilitiesInput {
  rows: readonly CapabilityColumnRow[];
  matchIndex: MatchIndex;
  llmClient: LlmClient;
  /** First `seq` the produced `supports` candidates may use — continuing straight on from whatever seq range `rowsToCandidates.ts` (and any other candidate-producing step already run) has used. */
  startSeq: number;
  /** K-13: read to decide whether an eligible row's `supports` edge may promote to `primary` — a target already has a live primary on this head iff `checkPrimaryCardinality` would refuse a new one. */
  mainHead: Head;
}

/** K-13/C17: true iff `capabilityElementId` already has a live `supports` edge with `role: 'primary'` on `mainHead` — mirrors `checkPrimaryCardinality`'s own read (`src/engine/deltas.ts`), read-only. */
function hasLivePrimarySupports(mainHead: Head, capabilityElementId: UUID): boolean {
  for (const rel of mainHead.relationships.values()) {
    if (rel.relationshipType === 'supports' && rel.toElementId === capabilityElementId && rel.attributes.role === 'primary') return true;
  }
  return false;
}

export interface AssignCapabilitiesResult {
  /** One `supports` `RowCandidate` per resolved target (`role: 'secondary'` always — see this module's own header comment on K-13 primary promotion). */
  candidates: RowCandidate[];
  /** Per-row summary, in `rows` order — `eligibleForPrimary` is the orchestrator's own input for K-13's promotion decision. */
  assignments: CapabilityAssignment[];
}

const EXTRACTOR_BY_SOURCE = { alias: 'sheet-mapping', trigram: 'sheet-mapping', llm: 'capability-llm' } as const;

/** §6.3, whole: alias/trigram pass first; prompt C only for what's left unresolved or ambiguous. */
export async function assignCapabilities(input: AssignCapabilitiesInput): Promise<AssignCapabilitiesResult> {
  const capabilityPool = input.matchIndex.elementsByType.get('capability') ?? [];
  const resolved = new Map<number, CapabilityTarget[]>();
  const needsPromptC: CapabilityColumnRow[] = [];

  for (const row of input.rows) {
    const aliasHit = input.matchIndex.aliasByNormalisedValue.get(normaliseName(row.capabilityText));
    const aliasElement = aliasHit ? input.matchIndex.elements.get(aliasHit.elementId) : undefined;
    if (aliasElement?.element_type === 'capability') {
      resolved.set(row.seq, [{ elementId: aliasElement.element_id, confidence: 1, source: 'alias' }]);
      continue;
    }

    const trigram = resolveByTrigram(row.capabilityText, capabilityPool);
    if (trigram.level === 'name_context' && !trigram.ambiguous && trigram.elementId !== undefined) {
      resolved.set(row.seq, [{ elementId: trigram.elementId, confidence: trigram.score, source: 'trigram' }]);
      continue;
    }

    needsPromptC.push(row);
  }

  if (needsPromptC.length > 0) {
    const { tree, codeToElementId } = buildCapabilityTree(capabilityPool);
    const promptCResults = await assignViaPromptC(needsPromptC, tree, codeToElementId, input.llmClient);
    for (const [seq, targets] of promptCResults) resolved.set(seq, targets);
  }

  const assignments: CapabilityAssignment[] = input.rows.map((row) => {
    const capabilities = resolved.get(row.seq) ?? [];
    return { seq: row.seq, capabilities, eligibleForPrimary: capabilities.length === 1 };
  });

  const candidates: RowCandidate[] = [];
  // K-13's "first... such edge" is checked across this whole run, not per row in isolation: two different rows
  // that both resolve to the same never-yet-primaried target must not both promote — that would hand
  // `write_capture_draft`'s own fold a second live primary on one target in the same commit, which C17
  // refuses (§8.1: "capture must never produce a draft commit commit_deltas refuses"). `input.rows` is
  // already in §4.5's deterministic row order, so "first" here means first in that order.
  const primaryClaimed = new Set<UUID>();
  let nextSeq = input.startSeq;
  for (const row of input.rows) {
    const targets = resolved.get(row.seq) ?? [];
    const eligibleForPrimary = targets.length === 1;
    for (const target of targets) {
      const role = eligibleForPrimary && !hasLivePrimarySupports(input.mainHead, target.elementId) && !primaryClaimed.has(target.elementId) ? 'primary' : 'secondary';
      if (role === 'primary') primaryClaimed.add(target.elementId);
      const proposal: RelationshipProposal<'supports'> = {
        kind: 'relationship',
        relationshipType: 'supports',
        from: { kind: 'candidate', seq: row.seq },
        to: { kind: 'existing', elementId: target.elementId },
        attributes: { role },
      };
      const evidence: CandidateEvidence = {
        sourceRef: row.sourceRef,
        passage: `${row.systemName} | ${row.capabilityText}`,
        extractor: EXTRACTOR_BY_SOURCE[target.source],
        attributeConfidence: { role: target.confidence },
        warnings: [],
      };
      candidates.push({ seq: nextSeq++, proposal, evidence, aliasProposals: [] });
    }
  }

  return { candidates, assignments };
}
