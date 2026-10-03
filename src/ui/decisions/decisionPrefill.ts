import type { UUID } from '../../contracts/delta';

/**
 * Prompt pack F3 PR6's "Start a decision" — what a click from a health
 * finding row (`ArchitectHome.tsx`'s Assurance panel) or a weak-capability
 * tile (`DirectorHome.tsx`'s door) hands to the Decisions list's own
 * creation form (`DecisionsView.tsx`), so the form opens already filled in
 * rather than blank. Carried as URL search params, not router state —
 * `?startFrom=...` is a real, shareable/bookmarkable link (the same
 * "prefer a URL over ephemeral navigation state" convention
 * `landscapeFilterParams.ts`/`zoomParams.ts` already establish elsewhere in
 * this app), not just a same-click handoff.
 *
 * `sourceFindingKey` is `decisions.source_finding_key` verbatim (ADR-022:
 * "a stable string key... matching ArchitectHome.tsx's own check keys") —
 * never a frozen snapshot of the finding's own computed text, since
 * findings are always recomputed live. The one entry point that isn't a
 * literal `ArchitectHome` check key (a weak-capability tile) still gets
 * its own stable key here, `'weak-capability'` — the column itself is a
 * bare `text`, not an enum, so this is a legitimate, deliberately
 * consistent extension of the same idea rather than a special case.
 */
export interface DecisionPrefillLinkedElement {
  id: UUID;
  name: string;
}

export interface DecisionPrefill {
  title: string;
  statement: string;
  sourceFindingKey: string;
  /**
   * F6.1 ("make capability fit-for-purpose visible to directors"):
   * widened from a single element to a non-empty array — every prefill
   * still names at least one concern, but the director door's own
   * "poor fit" pill (`prefillFromWeakFitCapabilities` below) needs to
   * link every individual poor-fit capability under a tile, not just the
   * tile's own level-1 capability. Backward compatible: every existing
   * `prefillFrom*` function still wraps a single element in a one-item
   * array, and `DecisionsView.tsx`'s own `links` form state already
   * accepted a list before this change — only this prefill's own shape
   * was singular.
   */
  linkedElements: readonly DecisionPrefillLinkedElement[];
}

/** `findCriticalSystemsPastOrNearSupportEnd`'s own finding (`ArchitectHome.tsx`'s `critical-support-end` check) — F3's own named "SAP PM" golden path. */
export function prefillFromCriticalSupportEndFinding(system: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Replace ${system.name}?`,
    statement: `${system.name} is critical and past or near its vendor support end — a decision is needed on what replaces it.`,
    sourceFindingKey: 'critical-support-end',
    linkedElements: [{ id: system.id, name: system.name }],
  };
}

/** The director door's own weak-capability tile (`DirectorHome.tsx`) — F3's second named golden path. `toneLabel` is the same word the tile's own chip already shows next to it (never colour-only), reused here so the pre-filled context names the exact same weakness the tile did. */
export function prefillFromWeakCapability(capability: { id: UUID; name: string }, toneLabel: string): DecisionPrefill {
  return {
    title: `What improves ${capability.name}?`,
    statement: `${capability.name} shows ${toneLabel} — a decision is needed on how to strengthen it.`,
    sourceFindingKey: 'weak-capability',
    linkedElements: [{ id: capability.id, name: capability.name }],
  };
}

/**
 * F6.1: the director door's own "poor fit" pill (`DirectorHome.tsx`) —
 * distinct from `prefillFromPoorFitCapabilityFinding` above (the Architect
 * door's own finding: primary supporters only, `poor` or `adequate`, one
 * capability at a time). This one names every individual capability in a
 * level-1 tile's own subtree whose `worstFitForPurpose` is `poor` across
 * *any* supports edge (`CapabilityTileData.weakFitCapabilities`,
 * `src/db/modelHome.ts`) — never the level-1 tile itself, and never
 * folded together with the Architect finding's own, separate check.
 * `tileCapabilityName` names the level-1 tile the pill lives on, for the
 * title/statement text only — it is not itself linked unless it also
 * appears in `capabilities`. Requires at least one capability; an empty
 * list is a caller bug (nothing to start a decision about).
 */
export function prefillFromWeakFitCapabilities(tileCapabilityName: string, capabilities: readonly { id: UUID; name: string }[]): DecisionPrefill {
  const names = capabilities.map((c) => c.name).join(', ');
  const isPlural = capabilities.length !== 1;
  return {
    title: `What improves fit under ${tileCapabilityName}?`,
    statement: `${isPlural ? `${String(capabilities.length)} capabilities under ${tileCapabilityName}` : `${names}, under ${tileCapabilityName},`} rated a poor or adequate fit${isPlural ? ` (${names})` : ''} — a decision is needed on how to improve ${isPlural ? 'them' : 'it'}.`,
    sourceFindingKey: 'poor-fit-director',
    linkedElements: capabilities.map((c) => ({ id: c.id, name: c.name })),
  };
}

/** `findCriticalExposedSystems`'s own finding (`ArchitectHome.tsx`'s `critical-exposed` check) — the architect door's three named decision-shaped findings' first member. */
export function prefillFromCriticalExposedFinding(system: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Replace ${system.name}?`,
    statement: `${system.name} is critical and exposed with no planned replacement — a decision is needed on what replaces it.`,
    sourceFindingKey: 'critical-exposed',
    linkedElements: [{ id: system.id, name: system.name }],
  };
}

/** `findCapabilitiesWithNoSupporters`'s own finding — read from Overview's "nothing recorded" tile (`DirectorHome.tsx`, its one home since 2026-10-03, UI-principles §3) and the Elements browse table's `capability-no-supporters` filter. */
export function prefillFromCapabilityNoSupportersFinding(capability: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Who supports ${capability.name}?`,
    statement: `${capability.name} has no known supporting system — a decision is needed on how it should be supported.`,
    sourceFindingKey: 'capability-no-supporters',
    linkedElements: [{ id: capability.id, name: capability.name }],
  };
}

/** F6's own "tap a weak stage" entry point (the Value streams page's inspector, and the element page for a stage) — same shape and reasoning as `prefillFromWeakCapability` above, `toneLabel` being the same word the stage tile's own tone-as-text already shows. */
export function prefillFromWeakStage(stage: { id: UUID; name: string }, toneLabel: string): DecisionPrefill {
  return {
    title: `What improves ${stage.name}?`,
    statement: `${stage.name} shows ${toneLabel} — a decision is needed on how to strengthen the capabilities that enable it.`,
    sourceFindingKey: 'weak-stage',
    linkedElements: [{ id: stage.id, name: stage.name }],
  };
}

/**
 * F11's own finding (`findOutgoingWithoutRetiringChange`, the architect
 * door's `outgoing-no-retiring-change` check): a system or module marked
 * Migrate or Eliminate with no open change retiring it. Phrased for its
 * one entry point, "Start a project" — the work, not a question.
 */
export function prefillFromOutgoingDisposition(element: { id: UUID; name: string }, disposition: 'migrate' | 'eliminate'): DecisionPrefill {
  return {
    title: disposition === 'migrate' ? `Migrate ${element.name}` : `Eliminate ${element.name}`,
    statement: `${element.name} is marked ${disposition === 'migrate' ? 'Migrate' : 'Eliminate'}, with no open change retiring it yet.`,
    sourceFindingKey: 'outgoing-no-retiring-change',
    linkedElements: [{ id: element.id, name: element.name }],
  };
}

const TITLE_PARAM = 'startTitle';
const STATEMENT_PARAM = 'startStatement';
const FINDING_KEY_PARAM = 'startFindingKey';
const ELEMENT_ID_PARAM = 'startElementId';
const ELEMENT_NAME_PARAM = 'startElementName';

/** Appended to a `/decisions` href — `URLSearchParams` handles the encoding, so callers never need to. `linkedElements` is carried as repeated `startElementId`/`startElementName` params, same index order, so an array of any length (including the common one-element case) round-trips through `parseDecisionPrefillFromSearchParams` unchanged. */
export function decisionPrefillToSearchParams(prefill: DecisionPrefill): URLSearchParams {
  const params = new URLSearchParams();
  params.set(TITLE_PARAM, prefill.title);
  params.set(STATEMENT_PARAM, prefill.statement);
  params.set(FINDING_KEY_PARAM, prefill.sourceFindingKey);
  for (const element of prefill.linkedElements) {
    params.append(ELEMENT_ID_PARAM, element.id);
    params.append(ELEMENT_NAME_PARAM, element.name);
  }
  return params;
}

/** The inverse of `decisionPrefillToSearchParams` — `null` unless every field the form needs is actually present (a bare `/decisions?ref=...` link, or one of these params stripped by hand, opens the form blank rather than half-filled), and the id/name lists are non-empty and the same length as each other. */
export function parseDecisionPrefillFromSearchParams(params: URLSearchParams): DecisionPrefill | null {
  const title = params.get(TITLE_PARAM);
  const statement = params.get(STATEMENT_PARAM);
  const sourceFindingKey = params.get(FINDING_KEY_PARAM);
  const ids = params.getAll(ELEMENT_ID_PARAM);
  const names = params.getAll(ELEMENT_NAME_PARAM);
  if (title === null || statement === null || sourceFindingKey === null || ids.length === 0 || ids.length !== names.length) return null;
  const linkedElements: DecisionPrefillLinkedElement[] = ids.map((id, index) => ({ id, name: names[index] ?? '' }));
  return { title, statement, sourceFindingKey, linkedElements };
}
