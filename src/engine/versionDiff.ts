/**
 * The version diff (UI-principles.md §6.2/§6.3): comparing two arbitrary
 * refs — `?ref=tag:v2026-Q2&diff=tag:v2026-Q1`, "how a director sees what
 * changed since last quarter." This is deliberately *not*
 * src/engine/branch.ts's `threeWayDiff`/`diffFacts`: that machinery is for
 * a genuinely three-party comparison (a branch's own base/ours/theirs,
 * SPEC §7.2, feeding the merge review queue's OURS/THEIRS/CONVERGED/
 * FIELD_CONFLICT vocabulary). Two tags are two points on main's one linear
 * history — there is no second party to converge with or conflict against,
 * only "what does the newer one have that the older one didn't." Reusing
 * `diffFacts` here (e.g. `diffFacts(asIs, toBe, toBe)`) would technically
 * run, but every changed fact would come back labelled `CONVERGED` — a
 * label whose entire meaning is "two independent sides independently
 * arrived at the same value," which is nonsense for two snapshots of the
 * same history. This module has its own, much simpler classification:
 * §6.3's Unchanged/Added/Removed/Changed/Moved, computed once at element
 * and relationship grain (not per fact-key — the highlighting rules never
 * distinguish which attribute changed by drawing it differently, only by
 * counting how many did, in the "~" badge).
 */
import { jsonDeepEqual } from './branch';
import type { ElementRow, Head, RelationshipRow } from './deltas';
import type { UUID } from '../contracts/delta';

export type VersionDiffState = 'unchanged' | 'added' | 'removed' | 'changed' | 'moved';

export interface ElementVersionDiff {
  elementId: UUID;
  state: VersionDiffState;
  asIs: ElementRow | null;
  toBe: ElementRow | null;
  /** Attribute keys (plus `'name'`) that differ, excluding `parentId` — a `moved` element's *other* attributes can also have changed; this still lists them, even though `moved` takes precedence over `changed` for the state itself (§6.3's table: a moved node gets the `⤴` marker, not a `~` count, but a diff consumer that wants both signals can still see what else changed here). */
  changedAttributes: string[];
}

/** Relationships have no `moved` state — their endpoints are immutable (S-5); re-pointing one is always retract-then-create, which is `removed` + `added`, not a single changed relationship. */
export type RelationshipVersionDiffState = 'unchanged' | 'added' | 'removed' | 'changed';

export interface RelationshipVersionDiff {
  relationshipId: UUID;
  state: RelationshipVersionDiffState;
  asIs: RelationshipRow | null;
  toBe: RelationshipRow | null;
  changedAttributes: string[];
}

export interface VersionDiff {
  elements: ElementVersionDiff[];
  relationships: RelationshipVersionDiff[];
}

function diffAttributes(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!jsonDeepEqual(a[key] ?? null, b[key] ?? null)) changed.push(key);
  }
  return changed.sort();
}

function diffElement(elementId: UUID, asIs: ElementRow | undefined, toBe: ElementRow | undefined): ElementVersionDiff {
  if (!toBe) return { elementId, state: 'removed', asIs: asIs ?? null, toBe: null, changedAttributes: [] };
  if (!asIs) return { elementId, state: 'added', asIs: null, toBe, changedAttributes: [] };

  const attributeChanges = diffAttributes(asIs.attributes, toBe.attributes);
  const changedAttributes = asIs.name !== toBe.name ? ['name', ...attributeChanges] : attributeChanges;
  const moved = asIs.parentId !== toBe.parentId;

  const state: VersionDiffState = moved ? 'moved' : changedAttributes.length > 0 ? 'changed' : 'unchanged';
  return { elementId, state, asIs, toBe, changedAttributes };
}

function diffRelationship(relationshipId: UUID, asIs: RelationshipRow | undefined, toBe: RelationshipRow | undefined): RelationshipVersionDiff {
  if (!toBe) return { relationshipId, state: 'removed', asIs: asIs ?? null, toBe: null, changedAttributes: [] };
  if (!asIs) return { relationshipId, state: 'added', asIs: null, toBe, changedAttributes: [] };

  const changedAttributes = diffAttributes(asIs.attributes, toBe.attributes);
  const state: RelationshipVersionDiffState = changedAttributes.length > 0 ? 'changed' : 'unchanged';
  return { relationshipId, state, asIs, toBe, changedAttributes };
}

/**
 * `asIs`/`toBe` name which side is which, matching §6.2's "As-is/To-be"
 * convention: `toBe` is the newer ref (`?ref=`), `asIs` the one being
 * compared against (`?diff=`) — swapping them flips every Added/Removed
 * label, which is the correct behaviour for viewing the same diff
 * backwards, not a bug to guard against.
 */
export function computeVersionDiff(asIs: Head, toBe: Head): VersionDiff {
  const elementIds = new Set([...asIs.elements.keys(), ...toBe.elements.keys()]);
  const elements = [...elementIds].map((id) => diffElement(id, asIs.elements.get(id), toBe.elements.get(id)));

  const relationshipIds = new Set([...asIs.relationships.keys(), ...toBe.relationships.keys()]);
  const relationships = [...relationshipIds].map((id) => diffRelationship(id, asIs.relationships.get(id), toBe.relationships.get(id)));

  return { elements, relationships };
}

/**
 * Fields the Landscape's "Changed" marker does not count. `computeVersionDiff`
 * above stays complete (a planned change must still apply a lifecycle or date
 * edit — `plannedFuture.ts` relies on any non-unchanged state), so this is a
 * display-only reading of it, applied by the Landscape alone.
 *  - The three dates: a date moving an item in or out of view already reads as
 *    Added/Removed. Lifecycle is deliberately NOT ignored: status colour is off
 *    while differences are highlighted, so a lifecycle edit would not show.
 *  - Free text and housekeeping: wording, sibling order, the starter-map link,
 *    the member link.
 *  - Email and Org unit: contact details, not a change to the estate.
 * Custom (org-defined) fields are not listed, so they count.
 */
export const LANDSCAPE_IGNORED_ELEMENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'introduced', 'plannedEnd', 'supportEndsAt',
  'description', 'transformation', 'inactiveReason',
  'order', 'templateRef', 'memberId',
  'email', 'orgUnit',
]);

/** Connections: wording (verb phrase, descriptions) and free-text fit notes. */
export const LANDSCAPE_IGNORED_RELATIONSHIP_ATTRIBUTES: ReadonlySet<string> = new Set(['description', 'fitForPurposeNotes']);

/**
 * The same diff as the Landscape marks it: an element or connection whose only
 * differences are ignored fields is unchanged; otherwise `changedAttributes`
 * lists just the fields that count. A `moved` element stays moved.
 */
export function forLandscapeDisplay(diff: VersionDiff): VersionDiff {
  return {
    elements: diff.elements.map((e) => {
      const changedAttributes = e.changedAttributes.filter((k) => !LANDSCAPE_IGNORED_ELEMENT_ATTRIBUTES.has(k));
      if (e.state !== 'changed') return { ...e, changedAttributes };
      return { ...e, state: changedAttributes.length > 0 ? 'changed' : 'unchanged', changedAttributes };
    }),
    relationships: diff.relationships.map((r) => {
      const changedAttributes = r.changedAttributes.filter((k) => !LANDSCAPE_IGNORED_RELATIONSHIP_ATTRIBUTES.has(k));
      if (r.state !== 'changed') return { ...r, changedAttributes };
      return { ...r, state: changedAttributes.length > 0 ? 'changed' : 'unchanged', changedAttributes };
    }),
  };
}
