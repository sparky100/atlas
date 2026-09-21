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
export interface DecisionPrefill {
  title: string;
  statement: string;
  sourceFindingKey: string;
  linkedElementId: UUID;
  linkedElementName: string;
}

const TITLE_PARAM = 'startTitle';
const STATEMENT_PARAM = 'startStatement';
const FINDING_KEY_PARAM = 'startFindingKey';
const ELEMENT_ID_PARAM = 'startElementId';
const ELEMENT_NAME_PARAM = 'startElementName';

/** `findCriticalSystemsPastOrNearSupportEnd`'s own finding (`ArchitectHome.tsx`'s `critical-support-end` check) — F3's own named "SAP PM" golden path. */
export function prefillFromCriticalSupportEndFinding(system: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Replace ${system.name}?`,
    statement: `${system.name} is critical and past or near its vendor support end — a decision is needed on what replaces it.`,
    sourceFindingKey: 'critical-support-end',
    linkedElementId: system.id,
    linkedElementName: system.name,
  };
}

/** The director door's own weak-capability tile (`DirectorHome.tsx`) — F3's second named golden path. `toneLabel` is the same word the tile's own chip already shows next to it (never colour-only), reused here so the pre-filled context names the exact same weakness the tile did. */
export function prefillFromWeakCapability(capability: { id: UUID; name: string }, toneLabel: string): DecisionPrefill {
  return {
    title: `What improves ${capability.name}?`,
    statement: `${capability.name} shows ${toneLabel} — a decision is needed on how to strengthen it.`,
    sourceFindingKey: 'weak-capability',
    linkedElementId: capability.id,
    linkedElementName: capability.name,
  };
}

/** `findCapabilitiesWithPoorFitPrimarySupporter`'s own finding (`ArchitectHome.tsx`'s `poor-fit-no-replacement` check) — a third "Start a decision" trigger alongside `critical-support-end` above and the director door's weak-capability tile. */
export function prefillFromPoorFitCapabilityFinding(capability: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `What replaces ${capability.name}'s primary supporter?`,
    statement: `${capability.name}'s primary supporter is rated a poor or adequate fit, with no planned replacement — a decision is needed on what to do about it.`,
    sourceFindingKey: 'poor-fit-no-replacement',
    linkedElementId: capability.id,
    linkedElementName: capability.name,
  };
}

/** `findCriticalExposedSystems`'s own finding (`ArchitectHome.tsx`'s `critical-exposed` check) — the architect door's three named decision-shaped findings' first member. */
export function prefillFromCriticalExposedFinding(system: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Replace ${system.name}?`,
    statement: `${system.name} is critical and exposed with no planned replacement — a decision is needed on what replaces it.`,
    sourceFindingKey: 'critical-exposed',
    linkedElementId: system.id,
    linkedElementName: system.name,
  };
}

/** `findCapabilitiesWithNoSupporters`'s own finding (`ArchitectHome.tsx`'s `capability-no-supporters` check) — the third of the architect door's three named decision-shaped findings. */
export function prefillFromCapabilityNoSupportersFinding(capability: { id: UUID; name: string }): DecisionPrefill {
  return {
    title: `Who supports ${capability.name}?`,
    statement: `${capability.name} has no known supporting system — a decision is needed on how it should be supported.`,
    sourceFindingKey: 'capability-no-supporters',
    linkedElementId: capability.id,
    linkedElementName: capability.name,
  };
}

/** F6's own "tap a weak stage" entry point (the Value streams page's inspector, and the element page for a stage) — same shape and reasoning as `prefillFromWeakCapability` above, `toneLabel` being the same word the stage tile's own tone-as-text already shows. */
export function prefillFromWeakStage(stage: { id: UUID; name: string }, toneLabel: string): DecisionPrefill {
  return {
    title: `What improves ${stage.name}?`,
    statement: `${stage.name} shows ${toneLabel} — a decision is needed on how to strengthen the capabilities that enable it.`,
    sourceFindingKey: 'weak-stage',
    linkedElementId: stage.id,
    linkedElementName: stage.name,
  };
}

/** Appended to a `/decisions` href — `URLSearchParams` handles the encoding, so callers never need to. */
export function decisionPrefillToSearchParams(prefill: DecisionPrefill): URLSearchParams {
  const params = new URLSearchParams();
  params.set(TITLE_PARAM, prefill.title);
  params.set(STATEMENT_PARAM, prefill.statement);
  params.set(FINDING_KEY_PARAM, prefill.sourceFindingKey);
  params.set(ELEMENT_ID_PARAM, prefill.linkedElementId);
  params.set(ELEMENT_NAME_PARAM, prefill.linkedElementName);
  return params;
}

/** The inverse of `decisionPrefillToSearchParams` — `null` unless every field the form needs is actually present (a bare `/decisions?ref=...` link, or one of these params stripped by hand, opens the form blank rather than half-filled). */
export function parseDecisionPrefillFromSearchParams(params: URLSearchParams): DecisionPrefill | null {
  const title = params.get(TITLE_PARAM);
  const statement = params.get(STATEMENT_PARAM);
  const sourceFindingKey = params.get(FINDING_KEY_PARAM);
  const linkedElementId = params.get(ELEMENT_ID_PARAM);
  const linkedElementName = params.get(ELEMENT_NAME_PARAM);
  if (title === null || statement === null || sourceFindingKey === null || linkedElementId === null || linkedElementName === null) return null;
  return { title, statement, sourceFindingKey, linkedElementId, linkedElementName };
}
