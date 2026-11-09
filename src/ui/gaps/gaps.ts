/**
 * F12 step 2: the gaps queue's own definitions — which Portfolio inputs are
 * missing, and the walkable list of items for each. Reads `PortfolioRow`s
 * (`usePortfolio.ts`, the same rows `missingPortfolioInputs` already reads),
 * so a gap here is exactly what the Portfolio view calls missing.
 *
 * Scope per gap (a judgment call recorded in the F12 plan's status):
 * - run cost: systems and modules, each element's own value (a module's
 *   cost is its own, never a share of its platform's);
 * - criticality, disposition: systems only — a module's value is an
 *   optional override, so leaving it unset isn't a gap;
 * - fit: one item per unrated `supports` edge, from a system or module;
 * - owner: systems with no `owns` edge of any role.
 * Retired elements are never gaps: there's nothing left to decide about them.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { PortfolioCapabilityLink, PortfolioRow } from '../portfolio/usePortfolio';

export type GapKind = 'run-cost' | 'criticality' | 'disposition' | 'fit' | 'owner';

export const GAP_KINDS: readonly GapKind[] = ['fit', 'owner', 'run-cost', 'criticality', 'disposition'];

export interface GapItem {
  kind: GapKind;
  /** Unique within its kind: the element id, or the edge id for a fit gap. */
  key: string;
  element: ElementsHeadRow;
  name: string;
  /** Fit gaps only: the unrated `supports` edge and the capability it points at. */
  link?: PortfolioCapabilityLink;
}

/** For an attribute gap, the element attribute it fills. */
export const GAP_ATTRIBUTE: Partial<Record<GapKind, string>> = { 'run-cost': 'annualRunCost', criticality: 'criticality', disposition: 'disposition' };

export function isGapKind(value: string | null): value is GapKind {
  return value !== null && (GAP_KINDS as readonly string[]).includes(value);
}

function isLive(row: PortfolioRow): boolean {
  return row.lifecycleStatus !== 'retired';
}

function isSystem(row: PortfolioRow): boolean {
  return row.element.element_type === 'system';
}

export function gapItems(kind: GapKind, rows: readonly PortfolioRow[]): GapItem[] {
  const live = rows.filter(isLive);
  const item = (row: PortfolioRow): GapItem => ({ kind, key: row.element.element_id, element: row.element, name: row.name });
  switch (kind) {
    case 'run-cost':
      return live.filter((row) => row.cost === null).map(item);
    case 'criticality':
      return live.filter((row) => isSystem(row) && row.criticality === null).map(item);
    case 'disposition':
      return live.filter((row) => isSystem(row) && row.disposition === null).map(item);
    case 'owner':
      return live.filter((row) => isSystem(row) && row.ownsEdges.length === 0).map(item);
    case 'fit':
      return live.flatMap((row) =>
        row.capabilities.filter((link) => link.fit === null).map((link) => ({ kind, key: link.relationship.relationship_id, element: row.element, name: row.name, link })),
      );
  }
}

/** How many elements a gap affects — for fit, distinct systems/modules, not edges. */
export function gapElementCount(items: readonly GapItem[]): number {
  return new Set<UUID>(items.map((i) => i.element.element_id)).size;
}

/** The queue's one-line summary, e.g. "23 systems have no fit rating". */
export function gapSummary(kind: GapKind, items: readonly GapItem[]): string {
  const n = gapElementCount(items);
  const things = (one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
  switch (kind) {
    case 'fit': {
      const links = items.length;
      return `${things('system has', 'systems have')} no fit rating${links !== n ? ` (${String(links)} capability links)` : ''}`;
    }
    case 'owner':
      return `${things('system has', 'systems have')} no owner`;
    case 'run-cost':
      return `${things('system or module has', 'systems and modules have')} no run cost`;
    case 'criticality':
      return `${things('system has', 'systems have')} no criticality`;
    case 'disposition':
      return `${things('system is', 'systems are')} missing a planned action`;
  }
}

/** The walk's heading for one item. */
export function gapItemQuestion(item: GapItem): string {
  switch (item.kind) {
    case 'fit':
      return `How well does ${item.name} fit ${item.link?.capabilityName ?? 'this capability'}?`;
    case 'owner':
      return `Who owns ${item.name}?`;
    case 'run-cost':
      return `What does ${item.name} cost to run each year?`;
    case 'criticality':
      return `How critical is ${item.name}?`;
    case 'disposition':
      return `What's the planned action for ${item.name}?`;
  }
}

/** The overview's line for a gap with nothing missing. */
export function gapDoneSummary(kind: GapKind): string {
  switch (kind) {
    case 'fit':
      return 'Every capability link has a fit rating';
    case 'owner':
      return 'Every system has an owner';
    case 'run-cost':
      return 'Every system and module has a run cost';
    case 'criticality':
      return 'Every system has a criticality';
    case 'disposition':
      return 'Every system has a planned action';
  }
}
