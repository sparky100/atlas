/**
 * Building the resolution deltas SPEC-data-model.md §7.4 describes for a
 * field-conflict card's actions ("keep this change / keep main / enter a
 * value"): each writes one `element.update`/`relationship.update` delta
 * whose `previousDeltaId` is *ours'* delta id (the branch's own currently-
 * asserting delta for that fact key — apply()/fold() (src/engine/deltas.ts)
 * never re-validates `previousDeltaId` against the head it's applied to,
 * but this module still sets it to the one value that's true regardless:
 * the delta this resolution is conceptually superseding on the branch's
 * own history), plus the matching `resolved_conflicts` row.
 *
 * Pure: takes an already-computed `FieldDiff[]` (src/engine/branch.ts) and
 * the folded `ours` Head (for each subject's `elementType`/
 * `relationshipType`, which `FieldDiff` itself doesn't carry) and a caller-
 * supplied id minter (CLAUDE.md rule 6: no `Math.random` here) — no I/O,
 * so a resolution can be previewed and unit-tested before anything is
 * committed.
 *
 * Scope (Sprint C1 step 7): field conflicts only. SPEC §7.4's structural-
 * conflict actions (keep retraction / keep element, duplicate-relationship
 * survivor pick, cardinality primary pick) and identity's "merge now" need
 * a dependency-closure cascade this module doesn't build — see
 * src/db/mergeRequests.ts's own module comment for where that's picked up.
 */
import type { Delta, UUID } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import type { FieldDiff } from './branch';
import type { Head } from './deltas';
import { EngineError } from './errors';

export type FieldConflictAction = 'keep-ours' | 'keep-theirs' | 'value';

export interface FieldConflictChoice {
  subjectId: UUID;
  attribute: string;
  action: FieldConflictAction;
  /** Required, and only meaningful, when `action === 'value'`. */
  value?: Json;
}

/** One `resolved_conflicts` row's worth of fields (ADR-007, SPEC §7.4) — camelCased; src/db/commits.ts's `ResolvedConflictInput` adds the `id` a caller mints for it. */
export interface ResolvedConflictFields {
  winningDeltaId: UUID;
  discardedDeltaId: UUID;
  resolutionDeltaId: UUID;
}

export interface BuiltFieldConflictResolutions {
  deltas: Delta[];
  resolvedConflicts: ResolvedConflictFields[];
}

/**
 * SPEC §7.5's C15: "the set of fact keys in resolutions must equal the set
 * of FIELD_CONFLICT keys." Folding a refresh's own deltas is applied *after*
 * main's exclusive commits are folded in (src/engine/head.ts's
 * `foldFromGenesis`, on a merge commit) — `apply()` never re-validates
 * `previousDeltaId` against the head it lands on, so an unresolved
 * FIELD_CONFLICT key doesn't fail loudly, it silently takes main's value,
 * discarding the branch's own one with no record at all. This is the guard
 * that stops that: every caller pushing a refresh checks this is empty
 * first (src/db/mergeRequests.ts's `pushRefresh`).
 */
export function unresolvedFieldConflictKeys(fields: readonly FieldDiff[], choices: readonly FieldConflictChoice[]): { subjectId: UUID; attribute: string }[] {
  const resolved = new Set(choices.map((c) => `${c.subjectId} ${c.attribute}`));
  return fields.filter((f) => f.classification === 'FIELD_CONFLICT' && !resolved.has(`${f.subjectId} ${f.attribute}`)).map((f) => ({ subjectId: f.subjectId, attribute: f.attribute }));
}

/**
 * Resolves every `choice` against its matching `FIELD_CONFLICT` entry in
 * `fields`. Throws (rather than silently skipping) for a choice that
 * doesn't match an actual field-conflict — a stale UI selection (the
 * classification moved since the reviewer staged it) should surface as an
 * error, not commit something no longer meant.
 *
 * Judgment call on `discardedDeltaId` for `action: 'value'` (SPEC §7.4
 * names `winningDeltaId` exactly — "the resolution delta itself" — but
 * doesn't say which side counts as discarded when neither is chosen
 * outright): this treats the branch's own superseded delta (`ours`) as
 * discarded in that case, same as it mechanically is the delta this
 * resolution's `previousDeltaId` points at.
 */
export function buildFieldConflictResolutions(fields: readonly FieldDiff[], ours: Head, choices: readonly FieldConflictChoice[], sourceId: UUID, mintId: () => UUID): BuiltFieldConflictResolutions {
  const deltas: Delta[] = [];
  const resolvedConflicts: ResolvedConflictFields[] = [];

  for (const choice of choices) {
    const field = fields.find((f) => f.subjectId === choice.subjectId && f.attribute === choice.attribute && f.classification === 'FIELD_CONFLICT');
    if (!field?.ours || !field.theirs) {
      throw new EngineError(`buildFieldConflictResolutions: no field-conflict for ${choice.subjectId}.${choice.attribute} (the branch may have moved since this choice was staged)`);
    }
    if (choice.action === 'value' && choice.value === undefined) {
      throw new EngineError(`buildFieldConflictResolutions: ${choice.subjectId}.${choice.attribute}'s action is "value" but no value was supplied`);
    }

    const value = choice.action === 'keep-ours' ? field.ours.value : choice.action === 'keep-theirs' ? field.theirs.value : (choice.value ?? null);
    const deltaId = mintId();
    const element = ours.elements.get(choice.subjectId);
    const relationship = ours.relationships.get(choice.subjectId);

    if (element) {
      deltas.push({
        kind: 'element.update',
        id: deltaId,
        elementId: choice.subjectId,
        elementType: element.elementType,
        attribute: choice.attribute,
        value,
        previousDeltaId: field.ours.deltaId,
        sourceId,
        confidence: 1,
      } as never);
    } else if (relationship) {
      deltas.push({
        kind: 'relationship.update',
        id: deltaId,
        relationshipId: choice.subjectId,
        relationshipType: relationship.relationshipType,
        attribute: choice.attribute,
        value,
        previousDeltaId: field.ours.deltaId,
        sourceId,
        confidence: 1,
      } as never);
    } else {
      throw new EngineError(`buildFieldConflictResolutions: ${choice.subjectId} is neither a known element nor relationship in ours`);
    }

    const winningDeltaId = choice.action === 'keep-ours' ? field.ours.deltaId : choice.action === 'keep-theirs' ? field.theirs.deltaId : deltaId;
    const discardedDeltaId = choice.action === 'keep-ours' ? field.theirs.deltaId : field.ours.deltaId;
    resolvedConflicts.push({ winningDeltaId, discardedDeltaId, resolutionDeltaId: deltaId });
  }

  return { deltas, resolvedConflicts };
}
