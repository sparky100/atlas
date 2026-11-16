import type { LifecycleState } from '../../../engine/elementRead/fitAndExposure';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-08-28" as "28 Aug 2027"; anything unreadable comes back as given. */
export function plainDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? iso : `${String(Number(match[3]))} ${month} ${String(match[1])}`;
}

/** The words on the tag: "Planned · from 28 Aug 2027" or "Retired · to 31 Dec 2026"; the date part is left off when none is recorded. */
export function lifecycleTagText(state: Exclude<LifecycleState, 'active'>, dates: { introduced?: string | undefined; plannedEnd?: string | undefined }): string {
  if (state === 'planned') return dates.introduced ? `Planned · from ${plainDate(dates.introduced)}` : 'Planned';
  return dates.plannedEnd ? `Retired · to ${plainDate(dates.plannedEnd)}` : 'Retired';
}

/** The one-line explanation behind the tag, for hover and screen readers. */
export function lifecycleTagTitle(state: Exclude<LifecycleState, 'active'>): string {
  return state === 'planned' ? 'Planned: not live yet. It counts from its Introduced date.' : 'Retired: no longer live. It stopped counting at its planned end.';
}
