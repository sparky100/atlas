/**
 * F11 (ADR-001 "Amended (Disposition, TIME)"): pure disposition helpers —
 * reading the attribute off an element, its worst-of order, and its chip
 * tone. Labels come from `attributeSchema.ts`'s single `DISPOSITION_LEVELS`
 * declaration, so this file can't drift from what the element page shows.
 *
 * A module's disposition is its own value only — never its platform's
 * (the override is not inherited), so `dispositionOf` takes no parent.
 */
import { DISPOSITION_LABELS, DISPOSITION_OPTIONS } from '../../contracts/attributeSchema';
import type { Disposition } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

/** Same "Not assessed" wording as the attribute editor's own `emptyLabel` — the one string for an unset disposition. */
export const DISPOSITION_NOT_ASSESSED_LABEL = 'Not assessed';

/** Worst-of order, best → worst: `invest < tolerate < migrate < eliminate`. Only for display roll-ups (the capability map's colour-by); never a score. */
export const DISPOSITION_ORDER: readonly Disposition[] = ['invest', 'tolerate', 'migrate', 'eliminate'];

/** `element`'s own disposition, or `null` when unset or unrecognised — never inherited from a platform. */
export function dispositionOf(element: ElementsHeadRow): Disposition | null {
  const value = attributesRecord(element.attributes).disposition;
  return typeof value === 'string' && (DISPOSITION_OPTIONS as readonly string[]).includes(value) ? (value as Disposition) : null;
}

export function dispositionLabel(value: Disposition | null): string {
  return value === null ? DISPOSITION_NOT_ASSESSED_LABEL : DISPOSITION_LABELS[value];
}

/** The worst disposition among `values`, skipping unset ones; `null` when none is set (never read as Tolerate). */
export function worstDisposition(values: readonly (Disposition | null)[]): Disposition | null {
  let worst: Disposition | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (worst === null || DISPOSITION_ORDER.indexOf(value) > DISPOSITION_ORDER.indexOf(worst)) worst = value;
  }
  return worst;
}

/** Whether a disposition says the system is on its way out — what the "no open change retiring it" finding checks. */
export function isOutgoingDisposition(value: Disposition | null): boolean {
  return value === 'migrate' || value === 'eliminate';
}
