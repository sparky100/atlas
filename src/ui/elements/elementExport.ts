/**
 * F8 export — the shared, pure builders behind both the CSV and the `.xlsx`
 * downloads (and the CSV-only narrowed scope this supersedes, issue #162).
 *
 * Columns = Name / Type / Owner, then every *core* attribute the element's
 * own type carries (`attributeSchema.ts`'s `ATTRIBUTE_SCHEMA_BY_TYPE`, in
 * schema order, hidden fields like `templateRef`/`memberId` excluded), then
 * every non-deprecated *custom* attribute applying to that type, then a
 * per-element *provenance summary* (`Source`, `Age` — the element's
 * `$exists` fact's source name and its staleness age, `formatAge`).
 *
 * `.xlsx` is one sheet per element type present in the set plus a
 * `Relationships` sheet (`From, Type, To, Verb, Role`) — `verb` from a
 * `uses`/`flows_to` edge's `description`, `role` from a `supports`/`owns`
 * edge's `role`. The CSV is one flat table: the union of every type's core
 * and custom columns, blank where a type doesn't carry an attribute.
 *
 * Generation is client-side (SheetJS `xlsx`); the browse table already
 * holds the whole model, and the export loader fetches facts + relationships
 * + sources lazily at download time, never on every render. Server-side
 * generation for very large models is deferred (documented, not silent) —
 * the model-scoped `selectAll` reads here are not the 50-id `.in()` guard
 * the original F8 note worried about.
 */
import type { ElementType, UUID } from '../../contracts/delta';
import { ATTRIBUTE_SCHEMA_BY_TYPE, attributeFieldSchema } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { AttributeDefinitionRow, SourceRow } from '../../db/types';
import type { BrowseRow } from '../../db/elementBrowse';
import { formatAge } from '../time';
import { attributesRecord, formatCustomAttributeValue as formatValue } from './attributesRecord';

export interface ExportColumn {
  key: string;
  label: string;
}

/** A stable element-type order for the union columns and the per-type sheets. */
export const EXPORT_TYPES: readonly ElementType[] = ['capability', 'system', 'container', 'actor', 'value_stream'];

const TYPE_SHEET_LABEL: Record<ElementType, string> = {
  capability: 'Capabilities',
  system: 'Systems',
  container: 'Containers',
  actor: 'Actors',
  value_stream: 'Value streams',
};

export function typeSheetLabel(type: ElementType): string {
  return TYPE_SHEET_LABEL[type];
}

/** The type's own core attribute columns, in schema order, hidden fields (templateRef/memberId) excluded. */
export function coreColumnsForType(type: ElementType): ExportColumn[] {
  return ATTRIBUTE_SCHEMA_BY_TYPE[type].filter((field) => !field.hidden).map((field) => ({ key: field.key, label: field.label }));
}

/** The non-deprecated custom attributes applying to `type`, in their own `order_index`. */
export function customColumnsForType(type: ElementType, definitions: readonly AttributeDefinitionRow[]): ExportColumn[] {
  return definitions
    .filter((d) => d.deprecated_at === null && d.applies_to.includes(type))
    .sort((a, b) => a.order_index - b.order_index)
    .map((d) => ({ key: d.key, label: d.label }));
}

/** The union of several column lists, deduplicated by key, first occurrence kept. */
export function unionColumns(lists: readonly (readonly ExportColumn[])[]): ExportColumn[] {
  const seen = new Set<string>();
  const out: ExportColumn[] = [];
  for (const list of lists) {
    for (const column of list) {
      if (!seen.has(column.key)) {
        seen.add(column.key);
        out.push(column);
      }
    }
  }
  return out;
}

const FIXED_COLUMNS: readonly ExportColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
];

const PROVENANCE_COLUMNS: readonly ExportColumn[] = [
  { key: 'source', label: 'Source' },
  { key: 'age', label: 'Age' },
];

export interface ExportProvenance {
  sourceName: string;
  age: string;
}

/** The per-element provenance summary, from each element's `$exists` fact + the sources that fact names. */
export function buildProvenanceById(facts: readonly FactsRow[], sourcesById: ReadonlyMap<UUID, SourceRow>, now: Date): Map<UUID, ExportProvenance> {
  const map = new Map<UUID, ExportProvenance>();
  for (const fact of facts) {
    if (fact.subject_type !== 'element' || fact.attribute !== '$exists') continue;
    const source = sourcesById.get(fact.source_id);
    const dateStr = fact.effective_date ?? fact.asserted_at;
    map.set(fact.subject_id, {
      sourceName: source?.name ?? '',
      age: dateStr ? formatAge(new Date(dateStr), now) : '',
    });
  }
  return map;
}

export interface RelationshipExportRow {
  from: string;
  type: string;
  to: string;
  verb: string;
  role: string;
}

/** `supports`/`uses`/`flows_to`/`owns` edges → the Relationships sheet's rows (`verb` = description, `role` = attributes.role). */
export function relationshipExportRows(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): RelationshipExportRow[] {
  return edges.map((edge) => {
    const attrs = attributesRecord(edge.attributes);
    return {
      from: elementsById.get(edge.from_element_id)?.name ?? '',
      type: edge.relationship_type,
      to: elementsById.get(edge.to_element_id)?.name ?? '',
      verb: typeof attrs.description === 'string' ? attrs.description : '',
      role: typeof attrs.role === 'string' ? attrs.role : '',
    };
  });
}

function cellValue(row: BrowseRow, key: string, provenanceById: ReadonlyMap<UUID, ExportProvenance>): string {
  if (key === 'name') return row.element.name;
  if (key === 'type') return row.element.element_type;
  if (key === 'owner') return row.owner?.name ?? '';
  if (key === 'source') return provenanceById.get(row.element.element_id)?.sourceName ?? '';
  if (key === 'age') return provenanceById.get(row.element.element_id)?.age ?? '';
  const raw = attributesRecord(row.element.attributes)[key];
  // A core enum field with a human label distinct from its stored key
  // (Run cost's bands) — same lookup AttributeRow.tsx's read display
  // uses, so an exported cell reads the same as the element page. Custom
  // attributes (no core field schema) and every enum without one of
  // these fall straight through to the raw formatter, unchanged.
  const field = attributeFieldSchema(row.element.element_type, key);
  if (field?.kind === 'enum' && typeof raw === 'string') {
    const label = field.optionLabels?.[raw];
    if (label !== undefined) return label;
  }
  return formatValue(raw);
}

function rowCells(row: BrowseRow, columns: readonly ExportColumn[], provenanceById: ReadonlyMap<UUID, ExportProvenance>): string[] {
  return columns.map((column) => cellValue(row, column.key, provenanceById));
}

/** The flat CSV column list — fixed columns, then the union of every type's core and custom columns, then provenance. */
export function flatColumns(definitions: readonly AttributeDefinitionRow[]): ExportColumn[] {
  return [
    ...FIXED_COLUMNS,
    ...unionColumns(EXPORT_TYPES.map((type) => coreColumnsForType(type))),
    ...unionColumns(EXPORT_TYPES.map((type) => customColumnsForType(type, definitions))),
    ...PROVENANCE_COLUMNS,
  ];
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** RFC 4180 CSV of the visible set — the flat union of core + custom + provenance columns. */
export function elementBrowseRowsToCsv(rows: readonly BrowseRow[], definitions: readonly AttributeDefinitionRow[], provenanceById: ReadonlyMap<UUID, ExportProvenance>): string {
  const columns = flatColumns(definitions);
  const lines = [csvRow(columns.map((c) => c.label))];
  for (const row of rows) {
    lines.push(csvRow(rowCells(row, columns, provenanceById)));
  }
  return lines.join('\r\n');
}

/** One xlsx sheet's worth of data, header row included — the pure half of the workbook, unit-testable without SheetJS. */
export interface ExportSheet {
  name: string;
  cells: string[][];
}

/** One sheet per element type present in the set, plus a `Relationships` sheet. */
export function buildExportSheets(rows: readonly BrowseRow[], definitions: readonly AttributeDefinitionRow[], provenanceById: ReadonlyMap<UUID, ExportProvenance>, relationships: readonly RelationshipExportRow[]): ExportSheet[] {
  const sheets: ExportSheet[] = [];
  for (const type of EXPORT_TYPES) {
    const typeRows = rows.filter((row) => row.element.element_type === type);
    if (typeRows.length === 0) continue;
    const columns = [...FIXED_COLUMNS, ...coreColumnsForType(type), ...customColumnsForType(type, definitions), ...PROVENANCE_COLUMNS];
    sheets.push({
      name: TYPE_SHEET_LABEL[type],
      cells: [columns.map((c) => c.label), ...typeRows.map((row) => rowCells(row, columns, provenanceById))],
    });
  }
  sheets.push({
    name: 'Relationships',
    cells: [['From', 'Type', 'To', 'Verb', 'Role'], ...relationships.map((rel) => [rel.from, rel.type, rel.to, rel.verb, rel.role])],
  });
  return sheets;
}

/** A safe, human-legible filename fragment — the model/view name isn't guaranteed filesystem-safe. */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'export';
}
