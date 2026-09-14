/**
 * Prompt pack F8 ("export"), narrowed scope — see issue #162 for the full
 * reasoning: CSV only (no `.xlsx` — no generation library exists in this
 * repo, and no "xlsx skill" is available in this environment either),
 * browse-table entry point only, columns matching exactly what the table
 * itself shows (`ElementBrowseTable.tsx`'s own `COLUMNS` plus the selected
 * custom-attribute column, if any) — no provenance summary, which would
 * need a `facts` join the browse table doesn't currently load.
 *
 * Pure string-building, no I/O: `useElementBrowse.ts` already loads and
 * filters the whole model client-side ("computed once against the loaded
 * set, not a live query" — that module's own comment), so exporting the
 * table's current view needs no extra fetch and no 500-row threshold.
 */
import type { AttributeDefinitionRow } from '../../db/types';
import type { BrowseRow } from '../../db/elementBrowse';
import { attributesRecord, formatCustomAttributeValue } from './attributesRecord';

/**
 * RFC 4180 quoting: wrap in double quotes whenever the value contains a
 * comma, a double quote, or a newline, doubling any embedded quote —
 * Excel, Numbers, and Google Sheets all read this correctly without a
 * "which dialect" question to answer here.
 */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * `rows` in whatever order/filter the caller already applied (the browse
 * table's own `state.rows` — already sorted, searched, and filtered by the
 * time this runs). `customDefinition` is the table's own currently-selected
 * custom-attribute column, or `undefined` for none — matching exactly what
 * a reviewer sees on screen, per the golden path's "confirm columns match
 * what was visible."
 */
export function elementBrowseRowsToCsv(rows: readonly BrowseRow[], customDefinition: AttributeDefinitionRow | undefined): string {
  const header = ['Name', 'Type', 'Owner', 'Lifecycle', ...(customDefinition ? [customDefinition.label] : [])];
  const lines = [csvRow(header)];
  for (const row of rows) {
    const cells = [row.element.name, row.element.element_type, row.owner?.name ?? '', row.lifecycleStatus ?? ''];
    if (customDefinition) cells.push(formatCustomAttributeValue(attributesRecord(row.element.attributes)[customDefinition.key]));
    lines.push(csvRow(cells));
  }
  // CRLF (RFC 4180's own line ending): Excel on Windows in particular is
  // markedly more reliable with this than a bare "\n" for a file it detects
  // as CSV rather than opens as plain text.
  return lines.join('\r\n');
}

/** A safe, human-legible filename fragment — the model/view name isn't guaranteed filesystem-safe (spaces are fine; slashes and quotes aren't). */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'export';
}
