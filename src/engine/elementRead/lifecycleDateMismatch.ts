/**
 * Where a system's or module's lifecycle status and its own dates disagree:
 * the status says where it stands today, the dates say when that changes,
 * so the two must tell the same story. Pure — the caller supplies "today"
 * (rule 6: nothing here reads a clock).
 *
 * Three cases, each with the one status that would fix it:
 * - marked active, but not introduced until a future date → planned;
 * - marked planned, but its introduced date has already come → active;
 * - marked active, but past its planned end date → retired.
 *
 * Retired and retiring elements are never flagged. A module with no
 * lifecycle of its own reads its platform's, the same fallback the rest of
 * the model uses.
 */
import type { LifecycleStatus, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

export type LifecycleMismatchKind = 'active-not-yet-introduced' | 'planned-already-introduced' | 'active-past-end';

export interface LifecycleMismatch {
  element: ElementsHeadRow;
  kind: LifecycleMismatchKind;
  /** The status the element's dates say it should have — what the one-click fix sets. */
  suggested: Extract<LifecycleStatus, 'planned' | 'active' | 'retired'>;
  /** The element's own recorded status at the point it was read (own, else its platform's). */
  current: LifecycleStatus;
  /** The date that disagrees with the status, as `YYYY-MM-DD`. */
  date: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function dateOf(value: unknown): string | null {
  return typeof value === 'string' && ISO_DATE.test(value) ? value.slice(0, 10) : null;
}

/** `YYYY-MM-DD` for `now`, in UTC — dates here carry no time or zone. */
export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** "1 Jan 2027" — plain-English form of a `YYYY-MM-DD` date. */
export function formatPlainDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The disagreement for one element, or `null` when its status and dates agree. `inheritedStatus` is the platform's status, read only when the element has none of its own. */
export function lifecycleMismatchOf(element: ElementsHeadRow, inheritedStatus: unknown, now: Date): LifecycleMismatch | null {
  if (element.element_type !== 'system' && element.element_type !== 'container') return null;
  const attrs = attributesRecord(element.attributes);
  const status = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : inheritedStatus;
  if (status !== 'active' && status !== 'planned') return null;
  const today = isoDay(now);
  const introduced = dateOf(attrs.introduced);
  const plannedEnd = dateOf(attrs.plannedEnd);
  if (status === 'active') {
    if (introduced !== null && introduced > today) return { element, kind: 'active-not-yet-introduced', suggested: 'planned', current: status, date: introduced };
    if (plannedEnd !== null && plannedEnd <= today) return { element, kind: 'active-past-end', suggested: 'retired', current: status, date: plannedEnd };
    return null;
  }
  if (introduced !== null && introduced <= today) return { element, kind: 'planned-already-introduced', suggested: 'active', current: status, date: introduced };
  return null;
}

/** Every system and module whose status and dates disagree, in the order given. */
export function findLifecycleDateMismatches(elements: readonly ElementsHeadRow[], now: Date): LifecycleMismatch[] {
  const byId = new Map<UUID, ElementsHeadRow>(elements.map((e) => [e.element_id, e]));
  const found: LifecycleMismatch[] = [];
  for (const element of elements) {
    const parent = element.parent_id !== null ? byId.get(element.parent_id) : undefined;
    const mismatch = lifecycleMismatchOf(element, parent ? attributesRecord(parent.attributes).lifecycleStatus : undefined, now);
    if (mismatch) found.push(mismatch);
  }
  return found;
}

/** One plain-English line saying what disagrees, e.g. "Marked active, but not introduced until 1 Jan 2027". */
export function describeLifecycleMismatch(mismatch: Pick<LifecycleMismatch, 'kind' | 'date'>): string {
  const date = formatPlainDate(mismatch.date);
  switch (mismatch.kind) {
    case 'active-not-yet-introduced':
      return `Marked active, but not introduced until ${date}`;
    case 'planned-already-introduced':
      return `Marked planned, but introduced on ${date}`;
    case 'active-past-end':
      return `Marked active, but its planned end was ${date}`;
  }
}

/** The label on the one-click fix. */
export function lifecycleFixLabel(suggested: LifecycleMismatch['suggested']): string {
  return `Set to ${suggested}`;
}
