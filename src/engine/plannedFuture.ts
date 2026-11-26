/**
 * The architecture "as at" a future date: today's head with the planned
 * changes that land by then laid on top, and systems whose own dates say
 * they have arrived or gone. Pure and deterministic (CLAUDE.md rule 6): the
 * same inputs always give the same picture, changes are applied in date
 * order with the change id as the tie-break, and nothing here reads a clock
 * (the caller passes `todayIso`). Nothing is stored — a view, like every
 * other view, is a query over the model (rule 2).
 *
 * A change is laid on as its own difference (`computeVersionDiff` of its
 * as-is and to-be heads), not by replaying its deltas on today's head, so a
 * change planned some time ago still applies after main has moved on.
 */
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow } from '../contracts/rows';
import { cloneHead, type Head } from './deltas';
import { lifecycleStateOf } from './elementRead/fitAndExposure';
import { computeVersionDiff } from './versionDiff';
import { isSystemLikeType } from '../contracts/elementKinds';

export interface PlannedChange {
  id: UUID;
  /** ISO date (YYYY-MM-DD) the change is meant to be live. */
  targetDate: string;
  /** The model as the change was started from. */
  asIs: Head;
  /** The model with the change made. */
  toBe: Head;
}

export interface FutureOverlap {
  elementId: UUID;
  /** Applied changes that both touch this element, in the order they were applied. */
  changeIds: UUID[];
}

export interface FutureProjection {
  head: Head;
  /** Ids of the changes laid on, in the order applied. */
  applied: UUID[];
  overlaps: FutureOverlap[];
}

/**
 * Systems and modules not live on `onIso` — planned (introduced after it) or
 * retired (ended by it, or marked retired with no end date), a module going
 * with its platform. Read through the one shared rule (`lifecycleStateOf`) so
 * this and every current-state view agree.
 */
function notLiveIds(head: Head, onIso: string): Set<UUID> {
  const now = new Date(`${onIso}T00:00:00Z`);
  const rows = new Map<UUID, ElementsHeadRow>();
  for (const [id, e] of head.elements) {
    if (isSystemLikeType(e.elementType)) rows.set(id, { element_id: id, element_type: e.elementType, name: e.name, parent_id: e.parentId, attributes: e.attributes, exists_delta_id: e.existsDeltaId });
  }
  const gone = new Set<UUID>();
  for (const [id, row] of rows) if (lifecycleStateOf(row, rows, now) !== 'active') gone.add(id);
  return gone;
}

/**
 * Today's picture as it really is: the head without the systems and modules
 * that are not live today (planned ones not yet introduced, retired ones past
 * their end) and without the links that touch them. This is the baseline a
 * future view is compared with, so a planned system that arrives by the date
 * reads as added, and one that is not live today or by then is not "removed".
 */
export function liveHead(head: Head, todayIso: string): Head {
  const live = cloneHead(head);
  for (const id of notLiveIds(head, todayIso)) live.elements.delete(id);
  dropDanglingRelationships(live);
  return live;
}

/** Drops every relationship with an end that is no longer in the head. */
function dropDanglingRelationships(head: Head): void {
  for (const [id, relationship] of head.relationships) {
    if (!head.elements.has(relationship.fromElementId) || !head.elements.has(relationship.toElementId)) head.relationships.delete(id);
  }
}

/**
 * @param today Main's head as it is now.
 * @param changes Planned changes with a target date; any dated after `asAt` are ignored.
 * @param asAt The date to look at, ISO. At or before `todayIso` the answer is simply today.
 */
export function projectFutureHead(today: Head, changes: readonly PlannedChange[], asAt: string, todayIso: string): FutureProjection {
  if (asAt <= todayIso) return { head: today, applied: [], overlaps: [] };

  const head = cloneHead(today);
  const due = changes.filter((c) => c.targetDate <= asAt).sort((a, b) => a.targetDate.localeCompare(b.targetDate) || a.id.localeCompare(b.id));

  const touchedBy = new Map<UUID, UUID[]>();
  const touch = (elementId: UUID, changeId: UUID) => {
    const ids = touchedBy.get(elementId) ?? [];
    if (!ids.includes(changeId)) ids.push(changeId);
    touchedBy.set(elementId, ids);
  };

  for (const change of due) {
    const diff = computeVersionDiff(change.asIs, change.toBe);
    for (const e of diff.elements) {
      if (e.state === 'unchanged') continue;
      touch(e.elementId, change.id);
      if (e.state === 'removed') head.elements.delete(e.elementId);
      else if (e.toBe) head.elements.set(e.elementId, { ...e.toBe, attributes: { ...e.toBe.attributes } });
    }
    for (const r of diff.relationships) {
      if (r.state === 'unchanged') continue;
      const ends = r.toBe ?? r.asIs;
      if (ends) {
        touch(ends.fromElementId, change.id);
        touch(ends.toElementId, change.id);
      }
      if (r.state === 'removed') head.relationships.delete(r.relationshipId);
      else if (r.toBe) head.relationships.set(r.relationshipId, { ...r.toBe, attributes: { ...r.toBe.attributes } });
    }
  }

  const overlaps: FutureOverlap[] = [...touchedBy.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([elementId, changeIds]) => ({ elementId, changeIds }))
    .sort((a, b) => a.elementId.localeCompare(b.elementId));

  // A system's own dates: gone once its planned end has passed, not there yet before it is introduced.
  const gone = notLiveIds(head, asAt);
  for (const id of gone) head.elements.delete(id);

  dropDanglingRelationships(head);
  return { head, applied: due.map((c) => c.id), overlaps };
}

export interface FutureWithBaseline extends FutureProjection {
  /** Today's live picture: what a future view is compared with. */
  baseline: Head;
}

/**
 * The future picture and the baseline to compare it with. The picture is
 * projected from the whole model — a planned system has to be in it to be
 * able to arrive by its date — while the baseline is today's live picture
 * (`liveHead`). Projecting from the live baseline instead would drop every
 * planned system before it could arrive.
 */
export function projectFutureWithBaseline(fullToday: Head, changes: readonly PlannedChange[], asAt: string, todayIso: string): FutureWithBaseline {
  return { ...projectFutureHead(fullToday, changes, asAt, todayIso), baseline: liveHead(fullToday, todayIso) };
}

/** Capabilities some system supports today that no system supports in the future picture — the "no system by then" problem. */
export function capabilitiesLeftWithoutSystem(today: Head, future: Head): UUID[] {
  const supported = (head: Head): Set<UUID> => {
    const ids = new Set<UUID>();
    for (const r of head.relationships.values()) {
      if (r.relationshipType === 'supports' && head.elements.has(r.fromElementId)) ids.add(r.toElementId);
    }
    return ids;
  };
  const before = supported(today);
  const after = supported(future);
  return [...before].filter((id) => !after.has(id) && future.elements.has(id)).sort();
}
