/**
 * The Landscape's Matrix view: systems down the side, capabilities across the
 * top, the fit rating where a system supports a capability. A pure view over
 * the same rows the Landscape already loads — it stores nothing and has no
 * layout of its own (a fixed grid, names in order), so there is no
 * `view_layouts` row behind it.
 *
 * Columns are level 1 capabilities. An expanded level 1 shows a column for
 * links made to it directly and one for each of its level 2 children (a link to
 * a level 3 capability counts under its level 2 parent). A collapsed level 1
 * counts every link beneath it. So each link lands in exactly one cell.
 */
import type { FitForPurpose, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { FIT_FOR_PURPOSE_ORDER } from '../../engine/elementRead/fitForPurpose';
import { fitForPurposeOf } from '../../engine/elementRead/fitAndExposure';
import { attributesRecord } from '../elements/attributesRecord';

export interface MatrixColumn {
  /** Unique key: `l1:<id>` for a level 1 column, `l2:<id>` for a child shown under an expanded level 1. */
  key: string;
  capabilityId: UUID;
  /** What the header says: the capability's name, or "<name>: directly" for links made to an expanded level 1 itself. */
  label: string;
  level: 1 | 2;
  /** The level 1 this column sits under (itself for a level 1 column). */
  l1Id: UUID;
  /** A level 1 column can be expanded or collapsed when it has children. */
  expandable: boolean;
  expanded: boolean;
}

export interface MatrixRow {
  system: ElementsHeadRow;
  /** 1 for a module nested under its platform. */
  depth: 0 | 1;
}

export interface MatrixCell {
  edges: RelationshipsHeadRow[];
  /** The worst fit among the cell's rated links, or null when none is rated. */
  fit: FitForPurpose | null;
  /** At least one link in the cell is marked primary. */
  primary: boolean;
}

export interface SupportMatrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  cells: Map<string, MatrixCell>;
  /** Links from a listed system to a capability that is not in the model's capability tree (a broken chain); counted, never silently dropped. */
  unplacedLinks: number;
}

export function cellKey(systemId: UUID, columnKey: string): string {
  return `${systemId}|${columnKey}`;
}

const byName = (a: ElementsHeadRow, b: ElementsHeadRow): number => a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);

export interface BuildSupportMatrixInput {
  /** The systems and modules to list (already narrowed by the Landscape's filters). */
  systems: readonly ElementsHeadRow[];
  /** Live `supports` links (already limited to live systems for the chosen date). */
  supportsEdges: readonly RelationshipsHeadRow[];
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** Level 1 capabilities shown open into their children. */
  expandedL1Ids: ReadonlySet<UUID>;
}

/** The level 1 and level 2 ancestors of a capability, or null when the chain doesn't reach a level 1. */
function chainOf(capabilityId: UUID, byId: ReadonlyMap<UUID, ElementsHeadRow>): { l1: ElementsHeadRow; l2: ElementsHeadRow | null } | null {
  let current = byId.get(capabilityId);
  let l2: ElementsHeadRow | null = null;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.parent_id === null) return { l1: current, l2 };
    l2 = current;
    current = byId.get(current.parent_id);
  }
  return null;
}

export function buildSupportMatrix({ systems, supportsEdges, capabilitiesById, expandedL1Ids }: BuildSupportMatrixInput): SupportMatrix {
  const l1s = [...capabilitiesById.values()].filter((c) => c.parent_id === null).sort(byName);
  const childrenOf = new Map<UUID, ElementsHeadRow[]>();
  for (const c of capabilitiesById.values()) {
    if (c.parent_id === null) continue;
    const list = childrenOf.get(c.parent_id) ?? [];
    list.push(c);
    childrenOf.set(c.parent_id, list);
  }

  const columns: MatrixColumn[] = [];
  for (const l1 of l1s) {
    const children = (childrenOf.get(l1.element_id) ?? []).sort(byName);
    const expanded = expandedL1Ids.has(l1.element_id) && children.length > 0;
    columns.push({ key: `l1:${l1.element_id}`, capabilityId: l1.element_id, label: expanded ? `${l1.name}: directly` : l1.name, level: 1, l1Id: l1.element_id, expandable: children.length > 0, expanded });
    if (expanded) for (const child of children) columns.push({ key: `l2:${child.element_id}`, capabilityId: child.element_id, label: child.name, level: 2, l1Id: l1.element_id, expandable: false, expanded: false });
  }

  // Platforms first by name, each followed by its own modules; a module whose platform isn't listed stands alone.
  const listedIds = new Set(systems.map((s) => s.element_id));
  const modulesByPlatform = new Map<UUID, ElementsHeadRow[]>();
  const top: ElementsHeadRow[] = [];
  for (const s of systems) {
    if (s.element_type === 'container' && s.parent_id !== null && listedIds.has(s.parent_id)) {
      const list = modulesByPlatform.get(s.parent_id) ?? [];
      list.push(s);
      modulesByPlatform.set(s.parent_id, list);
    } else top.push(s);
  }
  const rows: MatrixRow[] = [];
  for (const s of top.sort(byName)) {
    rows.push({ system: s, depth: 0 });
    for (const m of (modulesByPlatform.get(s.element_id) ?? []).sort(byName)) rows.push({ system: m, depth: 1 });
  }

  const rowIds = new Set(rows.map((r) => r.system.element_id));
  const columnKeys = new Set(columns.map((c) => c.key));
  const cells = new Map<string, MatrixCell>();
  let unplacedLinks = 0;
  for (const edge of supportsEdges) {
    if (!rowIds.has(edge.from_element_id)) continue;
    const chain = chainOf(edge.to_element_id, capabilitiesById);
    if (!chain) {
      unplacedLinks += 1;
      continue;
    }
    const expanded = expandedL1Ids.has(chain.l1.element_id) && (childrenOf.get(chain.l1.element_id)?.length ?? 0) > 0;
    const key = expanded && chain.l2 ? `l2:${chain.l2.element_id}` : `l1:${chain.l1.element_id}`;
    if (!columnKeys.has(key)) {
      unplacedLinks += 1;
      continue;
    }
    const id = cellKey(edge.from_element_id, key);
    const cell = cells.get(id) ?? { edges: [], fit: null, primary: false };
    cell.edges.push(edge);
    const fit = fitForPurposeOf(edge);
    if (fit !== null && (cell.fit === null || FIT_FOR_PURPOSE_ORDER[fit] > FIT_FOR_PURPOSE_ORDER[cell.fit])) cell.fit = fit;
    if (attributesRecord(edge.attributes).role === 'primary') cell.primary = true;
    cells.set(id, cell);
  }
  return { columns, rows, cells, unplacedLinks };
}

/** Links counted across the whole grid, plus the ones that couldn't be placed — equals the number of links from listed systems. */
export function matrixLinkCount(matrix: SupportMatrix): number {
  let n = matrix.unplacedLinks;
  for (const cell of matrix.cells.values()) n += cell.edges.length;
  return n;
}
