/**
 * F2-lite ("spreadsheet import as reconciliation") — resolves each parsed
 * row's own identity against the model's current elements, plus its
 * `platform`/`capability`/`business_owner`/`technical_owner` references.
 * Pure — takes already-loaded element lists, no Supabase call of its own,
 * so it's fully unit-testable against hand-built element sets.
 *
 * Two different resolution strategies, both stated in this session's own
 * plan:
 *
 *  - A row's own identity (`ElementMatchOutcome`) — "matched to an existing
 *    element by name or alias, exact case-insensitive; near-matches listed
 *    with same-as / new choices". A near-match (fuzzy trigram, the same
 *    `IDENTITY_TRIGRAM_THRESHOLD` E7/merge_elements and the old F2 Phase 2
 *    importer already use) is *never* auto-resolved here, even when there's
 *    only one candidate above the threshold — that's the one deliberate
 *    behaviour change from F2 Phase 2's own fuzzy tier, which did
 *    auto-resolve a lone leader. An exact tie (two live elements already
 *    share this exact name/alias) folds into the same "needs a pick"
 *    outcome as a near-match, since both need the identical same-as/new UI.
 *  - `platform`/`capability`/`business_owner`/`technical_owner` are plain
 *    references, not this row's own identity — these keep the old cascade
 *    (exact, then fuzzy auto-resolving a lone leader, ambiguous only on a
 *    genuine tie) rather than the stricter row-identity rule above. What
 *    differs between them is only what an unresolved reference *means*,
 *    decided by `buildImportCommit.ts`, not here: a `platform` that doesn't
 *    resolve is a hard row failure (platforms are matched, never
 *    auto-created — a typo silently spinning one up would be worse than
 *    refusing the row); a `capability` that doesn't resolve is a warning,
 *    no link (capabilities are never auto-created, same stance
 *    `docs/SPEC-capture.md` §15 already takes); an owner that doesn't
 *    resolve is created as a new actor (the spec's own "actors created if
 *    missing").
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { normalizeName } from '../engine/merge';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../engine/trigram';
import type { ImportRow } from './importRowSchema';

function systemKindOf(system: ElementsHeadRow): unknown {
  const attributes = system.attributes;
  return attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes) ? (attributes as Record<string, unknown>).kind : undefined;
}

/** A system's own `kind === 'platform'` — the same check `src/ui/elements/systemKind.ts`'s `isPlatform` makes, reimplemented rather than imported: `src/capture` is a pipeline stage `src/ui` depends on, never the other way (CLAUDE.md's own layering — crossing it here would be working around the layering, not a sign it's wrong). Exported for `notInFile.ts`'s own identical need, so the two don't each reimplement it. */
export function isPlatformSystem(system: ElementsHeadRow): boolean {
  return systemKindOf(system) === 'platform';
}

/** A system's own `kind === 'integration_platform'` — import close-out: what `via` (the Relationships sheet's own optional column) must resolve to, the same check `src/ui/elements/systemKind.ts`'s `isIntegrationPlatform` makes (reimplemented for the same layering reason `isPlatformSystem` above states). */
export function isIntegrationPlatformSystem(system: ElementsHeadRow): boolean {
  return systemKindOf(system) === 'integration_platform';
}

/** How close a second-best fuzzy candidate has to be to the best one to still count as a tie (`NameResolutionOutcome`'s own ambiguous case) — carried over from F2 Phase 2's own stated value. */
const AMBIGUITY_MARGIN = 0.05;

export interface ExistingElementRef {
  elementId: UUID;
  name: string;
}

/** This row's own identity — never auto-resolves a near-match; see this module's own doc comment. */
export type ElementMatchOutcome =
  | { kind: 'new' }
  | { kind: 'matched'; element: ExistingElementRef }
  | { kind: 'undecided'; candidates: ExistingElementRef[] }
  /** A module row (`platform` set) whose platform itself didn't resolve to exactly one existing platform — there is no pool of "this platform's modules" to match against, so this row can't proceed at all. Surfaced as a row failure, same bucket as a schema-validation error. */
  | { kind: 'blocked'; reason: string };

/** A plain reference column (`platform`/`capability`/`business_owner`/`technical_owner`) — old F2 Phase 2 cascade, auto-resolving a lone fuzzy leader. */
export type NameResolutionOutcome = { kind: 'none' } | { kind: 'new' } | { kind: 'matched'; element: ExistingElementRef } | { kind: 'ambiguous'; candidates: ExistingElementRef[] };

export interface MatchedImportRow {
  row: ImportRow;
  /** This row's own system-or-module identity. */
  match: ElementMatchOutcome;
  /** `{ kind: 'none' }` for a top-level system row (`row.platformName === null`). */
  platform: NameResolutionOutcome;
  /** One outcome per name in `row.capabilityNames` (import close-out's `|`-delimited list), same order — index 0 is the row's own primary candidate. */
  capabilities: NameResolutionOutcome[];
  businessOwner: NameResolutionOutcome;
  technicalOwner: NameResolutionOutcome;
}

/** Exported for `buildImportCommit.ts`'s own identical need — resolving a Relationships-sheet endpoint against the same element pools, by the same rule. */
export function toRefs(elements: readonly ElementsHeadRow[]): ExistingElementRef[] {
  return elements.map((e) => ({ elementId: e.element_id, name: e.name }));
}

/** Every distinct element in `pool` whose own name, or any known alias, normalizes to `name` — exact, case-insensitive (`normalizeName` is exactly trim+lowercase), name-or-alias per this session's own plan. Exported for `buildImportCommit.ts`'s own Relationships-sheet endpoint resolution — the identical rule, not a second implementation of it. */
export function exactMatches(name: string, pool: readonly ExistingElementRef[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>): ExistingElementRef[] {
  const target = normalizeName(name);
  return pool.filter((ref) => normalizeName(ref.name) === target || (aliasesByElementId.get(ref.elementId) ?? []).some((alias) => normalizeName(alias) === target));
}

/** Every candidate scoring `>= IDENTITY_TRIGRAM_THRESHOLD`, best first — the near-match candidate list itself is identical for both resolution strategies; only what a caller does with "exactly one, well clear of the rest" differs. */
function fuzzyMatches(name: string, pool: readonly ExistingElementRef[]): { ref: ExistingElementRef; score: number }[] {
  const target = normalizeName(name);
  return pool
    .map((ref) => ({ ref, score: trigramSimilarity(target, normalizeName(ref.name)) }))
    .filter((s) => s.score >= IDENTITY_TRIGRAM_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/** A row's own identity — exact (name-or-alias) first; a clean miss falls through to fuzzy, whose candidates always need an explicit pick, never auto-resolved (this module's own doc comment). */
function matchRowIdentity(name: string, pool: readonly ExistingElementRef[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>): ElementMatchOutcome {
  const exact = exactMatches(name, pool, aliasesByElementId);
  if (exact.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
    return { kind: 'matched', element: exact[0]! };
  }
  if (exact.length > 1) return { kind: 'undecided', candidates: exact };

  const fuzzy = fuzzyMatches(name, pool);
  if (fuzzy.length === 0) return { kind: 'new' };
  return { kind: 'undecided', candidates: fuzzy.map((s) => s.ref) };
}

/** A plain reference column — exact (name-or-alias) first, then fuzzy auto-resolving a lone leader; only a genuine tie (exact or fuzzy-within-margin) is ambiguous. */
function resolveReference(name: string | null, pool: readonly ExistingElementRef[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>): NameResolutionOutcome {
  if (name === null) return { kind: 'none' };
  const exact = exactMatches(name, pool, aliasesByElementId);
  if (exact.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
    return { kind: 'matched', element: exact[0]! };
  }
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

  const fuzzy = fuzzyMatches(name, pool);
  const best = fuzzy[0];
  if (!best) return { kind: 'new' };
  const tiedWithBest = fuzzy.filter((s) => best.score - s.score < AMBIGUITY_MARGIN);
  if (tiedWithBest.length > 1) return { kind: 'ambiguous', candidates: tiedWithBest.map((s) => s.ref) };
  return { kind: 'matched', element: best.ref };
}

export interface MatchImportRowsInput {
  rows: readonly ImportRow[];
  /** Every live system in the model, any `kind` — a row's own identity pool when `row.elementType === 'system'`, and the pool `platform` resolves against, filtered to `attributes.kind === 'platform'`. */
  systems: readonly ElementsHeadRow[];
  /** Every live container in the model — a module row's own identity is matched only among a *resolved* platform's own modules (`parent_id` equal to it), never the whole pool. */
  containers: readonly ElementsHeadRow[];
  capabilities: readonly ElementsHeadRow[];
  actors: readonly ElementsHeadRow[];
  /** `listAliasesForModel`'s own shape (`src/db/aliases.ts`) — every live alias, grouped by the element it names, `merged_id` excluded (an alias to a merged-away element could never plausibly be *this* file's own subject). */
  aliasesByElementId: ReadonlyMap<UUID, readonly string[]>;
}

/** `systems`/`containers`/`capabilities`/`actors` are the target branch's own current head rows (the same reads every other page already does); this module doesn't fetch anything itself. */
export function matchImportRows(input: MatchImportRowsInput): MatchedImportRow[] {
  const { rows, systems, containers, capabilities, actors, aliasesByElementId } = input;
  const platformPool = toRefs(systems.filter(isPlatformSystem));
  const capabilityPool = toRefs(capabilities);
  const actorPool = toRefs(actors);

  return rows.map((row): MatchedImportRow => {
    const capabilities = row.capabilityNames.map((name) => resolveReference(name, capabilityPool, aliasesByElementId));
    const businessOwner = resolveReference(row.businessOwner?.name ?? null, actorPool, aliasesByElementId);
    const technicalOwner = resolveReference(row.technicalOwner?.name ?? null, actorPool, aliasesByElementId);

    if (row.elementType === 'system') {
      return { row, match: matchRowIdentity(row.name, toRefs(systems), aliasesByElementId), platform: { kind: 'none' }, capabilities, businessOwner, technicalOwner };
    }

    // `elementType === 'container'` iff `platformName !== null` (importRowSchema.ts) — `resolveReference` itself takes `string | null` regardless, so no assertion is needed to satisfy the type checker.
    const platform = resolveReference(row.platformName, platformPool, aliasesByElementId);
    if (platform.kind !== 'matched') {
      const reason = platform.kind === 'new' ? `platform "${row.platformName ?? ''}" was not found — a platform is matched, never created by an import` : `platform "${row.platformName ?? ''}" matched more than one existing platform`;
      return { row, match: { kind: 'blocked', reason }, platform, capabilities, businessOwner, technicalOwner };
    }
    const modulePool = toRefs(containers.filter((c) => c.parent_id === platform.element.elementId));
    return { row, match: matchRowIdentity(row.name, modulePool, aliasesByElementId), platform, capabilities, businessOwner, technicalOwner };
  });
}
