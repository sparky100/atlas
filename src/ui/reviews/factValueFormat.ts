/** A fact's own value, formatted for a card — split out of ConflictCards.tsx so that file exports components only (react-refresh/only-export-components). Same convention as src/ui/changes/changeSummaryFormat.ts's own `formatValue`. */
export function formatFactValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
