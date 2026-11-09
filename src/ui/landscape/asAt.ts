/** The "View as at" date on the Landscape: today or a future date, kept in the URL as `?asat=YYYY-MM-DD`. Today is the default and is never written to the URL. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const AS_AT_PARAM = 'asat';
/** `?asat=` is a future picture; `?compare=off` shows it plain instead of highlighting what differs from today. */
export const AS_AT_COMPARE_PARAM = 'compare';

export interface AsAtPreset {
  label: string;
  months: number;
}

export const AS_AT_PRESETS: readonly AsAtPreset[] = [
  { label: 'Today', months: 0 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
];

export function todayIsoDate(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `iso` moved on by `months`, keeping the day of the month or the last day of a shorter month (31 Aug + 6 months is 28 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return iso;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** The date a preset points at, as an `asat` value: `null` for Today (the default). */
export function presetAsAt(preset: AsAtPreset, todayIso: string): string | null {
  return preset.months === 0 ? null : addMonthsIso(todayIso, preset.months);
}

/** A usable future date from the URL, else `null` (today). A malformed, impossible, or past/today date means today. */
export function parseAsAtParam(value: string | null, todayIso: string): string | null {
  if (value === null) return null;
  const match = ISO_DATE.exec(value);
  if (!match || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null;
  return value > todayIso ? value : null;
}
