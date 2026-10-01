/**
 * F9 step 3: the Reports page's count lines — pure, so the wording (and the
 * "never show a guessed number" rule) is checkable without a database.
 * `null` means the report's own data hasn't loaded yet; an error is passed
 * as `'error'`. Neither ever renders as zero.
 */
export type ReportCount = number | null | 'error';

export function countLine(count: ReportCount, singular: string, plural: string): string {
  if (count === null) return 'Loading…';
  if (count === 'error') return "Couldn't load this count.";
  return `${String(count)} ${count === 1 ? singular : plural}`;
}
