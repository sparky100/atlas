/**
 * F8 export — the shared, pure builders behind both the CSV and the `.xlsx`
 * downloads (and the CSV-only narrowed scope this supersedes, issue #162).
 *
 * Columns = Name / Type / Owner, then (for a type with a parent) the parent's
 * name, then every *core* attribute the element's own type carries (`attributeSchema.ts`'s `ATTRIBUTE_SCHEMA_BY_TYPE`, in
 * schema order, hidden fields like `templateRef`/`memberId` excluded), then
 * every non-deprecated *custom* attribute applying to that type, then a
 * per-element *provenance summary* (`Source`, `Age` — the element's
 * `$exists` fact's source name and its staleness age, `formatAge`), then the
 * element's `Atlas ID`.
 *
 * **Amended 2026-10-08 (round trip):** the parent column and the Atlas ID
 * are what let this workbook be imported again. Without a parent column a
 * module's platform isn't in the file, so every module came back with no
 * platform; without the ID a re-import matched by name alone. The parent
 * columns are named for the importer's own synonym table ("Parent system"
 * on a module sheet, "Parent capability" on a capability sheet, "Parent" on
 * the flat CSV), and "Atlas ID" is its `atlasId` role. An actor's own
 * `Type` (person/team) is written as "Actor type", so the sheet no longer
 * has two columns both called "Type".
 *
 * `.xlsx` is one sheet per element type present in the set plus a
 * `Relationships` sheet (`From, Type, To, Verb, Role, Via, Data classification, Protocol in, Protocol out`) —
 * `verb` from a `uses`/`flows_to` edge's `description`, `role` from a
 * `supports`/`owns` edge's `role`, `via` the integration platform a
 * `uses`/`flows_to` flow goes through, `data classification` a `flows_to`
 * edge's own. The CSV is one flat table: the union of every type's core
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
import { ATTRIBUTE_SCHEMA_BY_TYPE } from '../../contracts/attributeSchema';
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
/**
 * Export-only header overrides, for a header the importer would read as
 * something else. An actor's `subtype` is "Type" in the app, which here
 * would sit beside the fixed `Type` (the element type) as a second column of
 * the same name. A system's `domain` (it / ot / hybrid) is "Domain" in the
 * app, but the importer's synonym table reads a "Domain" header as a
 * *business area* — a capability list — so "it" or "hybrid" would be sent to
 * capability matching as if it were a capability.
 */
const EXPORT_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'actor.subtype': 'Actor type',
  'system.domain': 'IT/OT domain',
};

export function coreColumnsForType(type: ElementType): ExportColumn[] {
  return ATTRIBUTE_SCHEMA_BY_TYPE[type]
    .filter((field) => !field.hidden)
    .map((field) => ({ key: field.key, label: EXPORT_LABEL_OVERRIDES[`${type}.${field.key}`] ?? field.label }));
}

/** The column holding an element's parent's name — what makes the hierarchy survive a round trip. Only the types that have a parent get one. */
const PARENT_COLUMN_BY_TYPE: Partial<Record<ElementType, ExportColumn>> = {
  capability: { key: 'parent', label: 'Parent capability' },
  container: { key: 'parent', label: 'Parent system' },
  value_stream: { key: 'parent', label: 'Parent stream' },
};

function parentColumnsForType(type: ElementType): ExportColumn[] {
  const column = PARENT_COLUMN_BY_TYPE[type];
  return column ? [column] : [];
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

/** Last on every sheet: the importer's `atlasId` role matches on it first (exact id), ahead of any name. */
const ID_COLUMNS: readonly ExportColumn[] = [{ key: 'atlasId', label: 'Atlas ID' }];

/** The flat CSV mixes every type in one table, so its one parent column is just "Parent". */
const FLAT_PARENT_COLUMN: ExportColumn = { key: 'parent', label: 'Parent' };

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
  /** The integration platform a `uses`/`flows_to` flow goes via, named like an endpoint ("Parent · Name" when the name is shared). */
  via: string;
  dataClassification: string;
  /** ADR-026: each side's protocol on a flow through a platform (stored keys, read back by key or label). */
  protocolIn: string;
  protocolOut: string;
}

/**
 * How an element is named as a relationship's endpoint: its own name, unless
 * another element in the model has the same name (two platforms each with a
 * module "PM"), when it is qualified by its parent — "SAP · PM", the form
 * the importer resolves. A bare shared name would link to whichever the
 * importer found first.
 */
export function endpointName(element: ElementsHeadRow | undefined, elementsById: ReadonlyMap<UUID, ElementsHeadRow>, nameCounts: ReadonlyMap<string, number>): string {
  if (!element) return '';
  if ((nameCounts.get(element.name) ?? 0) < 2 || element.parent_id === null) return element.name;
  const parent = elementsById.get(element.parent_id);
  return parent ? `${parent.name} · ${element.name}` : element.name;
}

/** A `via` cell: the platform's name, or — ADR-026 — an interface always qualified by its platform ("MuleSoft · Reads API"), so the sheet says which platform the flow goes through even when the interface's own name is unique. */
function viaName(element: ElementsHeadRow | undefined, elementsById: ReadonlyMap<UUID, ElementsHeadRow>): string {
  if (!element) return '';
  const parent = element.parent_id !== null ? elementsById.get(element.parent_id) : undefined;
  return parent ? `${parent.name} · ${element.name}` : element.name;
}

/** `supports`/`uses`/`flows_to`/`owns` edges → the Relationships sheet's rows (`verb` = description, `role` = attributes.role). */
export function relationshipExportRows(edges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): RelationshipExportRow[] {
  const nameCounts = new Map<string, number>();
  for (const element of elementsById.values()) nameCounts.set(element.name, (nameCounts.get(element.name) ?? 0) + 1);
  return edges.map((edge) => {
    const attrs = attributesRecord(edge.attributes);
    return {
      from: endpointName(elementsById.get(edge.from_element_id), elementsById, nameCounts),
      type: edge.relationship_type,
      to: endpointName(elementsById.get(edge.to_element_id), elementsById, nameCounts),
      verb: typeof attrs.description === 'string' ? attrs.description : '',
      role: typeof attrs.role === 'string' ? attrs.role : '',
      via: typeof attrs.via === 'string' ? viaName(elementsById.get(attrs.via), elementsById) : '',
      dataClassification: typeof attrs.dataClassification === 'string' ? attrs.dataClassification : '',
      protocolIn: typeof attrs.protocolIn === 'string' ? attrs.protocolIn : '',
      protocolOut: typeof attrs.protocolOut === 'string' ? attrs.protocolOut : '',
    };
  });
}

function cellValue(row: BrowseRow, key: string, provenanceById: ReadonlyMap<UUID, ExportProvenance>, parentNameById: ReadonlyMap<UUID, string>): string {
  if (key === 'name') return row.element.name;
  if (key === 'type') return row.element.element_type;
  if (key === 'owner') return row.owner?.name ?? '';
  if (key === 'parent') return row.element.parent_id !== null ? (parentNameById.get(row.element.parent_id) ?? '') : '';
  if (key === 'atlasId') return row.element.element_id;
  if (key === 'source') return provenanceById.get(row.element.element_id)?.sourceName ?? '';
  if (key === 'age') return provenanceById.get(row.element.element_id)?.age ?? '';
  return formatValue(attributesRecord(row.element.attributes)[key]);
}

function rowCells(row: BrowseRow, columns: readonly ExportColumn[], provenanceById: ReadonlyMap<UUID, ExportProvenance>, parentNameById: ReadonlyMap<UUID, string>): string[] {
  return columns.map((column) => cellValue(row, column.key, provenanceById, parentNameById));
}

/** The flat CSV column list — fixed columns, then the union of every type's core and custom columns, then provenance. */
export function flatColumns(definitions: readonly AttributeDefinitionRow[]): ExportColumn[] {
  return [
    ...FIXED_COLUMNS,
    FLAT_PARENT_COLUMN,
    ...unionColumns(EXPORT_TYPES.map((type) => coreColumnsForType(type))),
    ...unionColumns(EXPORT_TYPES.map((type) => customColumnsForType(type, definitions))),
    ...PROVENANCE_COLUMNS,
    ...ID_COLUMNS,
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
export function elementBrowseRowsToCsv(rows: readonly BrowseRow[], definitions: readonly AttributeDefinitionRow[], provenanceById: ReadonlyMap<UUID, ExportProvenance>, parentNameById: ReadonlyMap<UUID, string> = new Map()): string {
  const columns = flatColumns(definitions);
  const lines = [csvRow(columns.map((c) => c.label))];
  for (const row of rows) {
    lines.push(csvRow(rowCells(row, columns, provenanceById, parentNameById)));
  }
  return lines.join('\r\n');
}

/** One xlsx sheet's worth of data, header row included — the pure half of the workbook, unit-testable without SheetJS. */
export interface ExportSheet {
  name: string;
  cells: string[][];
}

/** One sheet per element type present in the set, plus a `Relationships` sheet. */
export function buildExportSheets(rows: readonly BrowseRow[], definitions: readonly AttributeDefinitionRow[], provenanceById: ReadonlyMap<UUID, ExportProvenance>, relationships: readonly RelationshipExportRow[], parentNameById: ReadonlyMap<UUID, string> = new Map()): ExportSheet[] {
  const sheets: ExportSheet[] = [];
  for (const type of EXPORT_TYPES) {
    const typeRows = rows.filter((row) => row.element.element_type === type);
    if (typeRows.length === 0) continue;
    const columns = [...FIXED_COLUMNS, ...parentColumnsForType(type), ...coreColumnsForType(type), ...customColumnsForType(type, definitions), ...PROVENANCE_COLUMNS, ...ID_COLUMNS];
    sheets.push({
      name: TYPE_SHEET_LABEL[type],
      cells: [columns.map((c) => c.label), ...typeRows.map((row) => rowCells(row, columns, provenanceById, parentNameById))],
    });
  }
  sheets.push({
    name: 'Relationships',
    cells: [['From', 'Type', 'To', 'Verb', 'Role', 'Via', 'Data classification', 'Protocol in', 'Protocol out'], ...relationships.map((rel) => [rel.from, rel.type, rel.to, rel.verb, rel.role, rel.via, rel.dataClassification, rel.protocolIn, rel.protocolOut])],
  });
  return sheets;
}

/** A safe, human-legible filename fragment — the model/view name isn't guaranteed filesystem-safe. */
export function sanitizeForFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').trim() || 'export';
}
