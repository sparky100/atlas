/**
 * Plan B1 (Simon, 2026-11-19, "A: before/after per capability"): for each
 * capability a project names, the systems that support it today and after
 * each drafted change, with each system's connected apps and integrations.
 * Derived from two heads (nothing stored, CLAUDE.md rules 2 and 3), reusing
 * the Context view's own grouping (`computeContextGroup`) so "related apps"
 * means the same here as on a system's Context page.
 *
 * The "after" column lists what is there afterwards, marked `new` where it
 * wasn't before, plus what goes away, marked `ends`, so a reader sees both.
 * Marks are always shown as words, never colour alone.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { ElementRow, Head, RelationshipRow } from '../../engine/deltas';
import { edgesInForce, lifecycleStateOf } from '../../engine/elementRead/fitAndExposure';
import { computeContextGroup, edgeLabel } from '../context/contextGrouping';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';

export type BeforeAfterMark = 'same' | 'new' | 'ends';

export interface BeforeAfterConnection {
  /** Neighbour id plus the edge's label: stable across heads, so the two sides can be compared. */
  key: string;
  appId: UUID;
  appName: string;
  isExternal: boolean;
  /** The edge's own verb phrase with its direction arrow ("sends invoices ⇢"). */
  label: string;
  mark: BeforeAfterMark;
}

export interface BeforeAfterSystem {
  id: UUID;
  name: string;
  mark: BeforeAfterMark;
  connections: BeforeAfterConnection[];
}

export interface BeforeAfterColumn {
  /** `null` for "Today"; the change's id for an "After" column. */
  changeId: UUID | null;
  title: string;
  systems: BeforeAfterSystem[];
}

export interface BeforeAfterCapability {
  id: UUID;
  name: string;
  today: BeforeAfterColumn;
  after: BeforeAfterColumn[];
}

export interface BeforeAfterChange {
  id: UUID;
  title: string;
  head: Head;
}

interface HeadView {
  elementsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
}

function elementRow(id: UUID, row: ElementRow): ElementsHeadRow {
  return { element_id: id, element_type: row.elementType, name: row.name, parent_id: row.parentId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function relationshipRow(id: UUID, row: RelationshipRow): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: row.relationshipType, from_element_id: row.fromElementId, to_element_id: row.toElementId, attributes: row.attributes, exists_delta_id: row.existsDeltaId };
}

function viewOf(head: Head): HeadView {
  const elementsById = new Map<UUID, ElementsHeadRow>();
  for (const [id, row] of head.elements) elementsById.set(id, elementRow(id, row));
  const edges: RelationshipsHeadRow[] = [];
  for (const [id, row] of head.relationships) edges.push(relationshipRow(id, row));
  return { elementsById, edges };
}

/** Systems in force that support the capability, each with its connected apps, in one head. */
function systemsIn(view: HeadView, capabilityId: UUID, now: Date): Map<UUID, { name: string; connections: Map<string, BeforeAfterConnection> }> {
  const result = new Map<UUID, { name: string; connections: Map<string, BeforeAfterConnection> }>();
  const supporterIds = new Set(view.edges.filter((e) => e.relationship_type === 'supports' && e.to_element_id === capabilityId).map((e) => e.from_element_id));
  for (const id of supporterIds) {
    const system = view.elementsById.get(id);
    if (!system || (system.element_type !== 'system' && system.element_type !== 'container')) continue;
    if (lifecycleStateOf(system, view.elementsById, now) !== 'active') continue;
    const touching = edgesInForce(
      view.edges.filter((e) => e.from_element_id === id || e.to_element_id === id),
      view.elementsById,
      now,
    );
    const group = computeContextGroup(system, touching, view.elementsById);
    const connections = new Map<string, BeforeAfterConnection>();
    for (const [neighbours, isExternal] of [[group.internal, false], [group.external, true]] as const) {
      for (const n of neighbours) {
        for (const edge of n.edges) {
          const label = edgeLabel(edge, id);
          const key = `${n.element.element_id}|${label}`;
          connections.set(key, { key, appId: n.element.element_id, appName: n.displayName, isExternal, label, mark: 'same' });
        }
      }
    }
    result.set(id, { name: moduleDisplayNameFromMap(system, view.elementsById), connections });
  }
  return result;
}

type SystemsMap = ReturnType<typeof systemsIn>;

function toSystems(map: SystemsMap): BeforeAfterSystem[] {
  return [...map.entries()]
    .map(([id, s]) => ({ id, name: s.name, mark: 'same' as const, connections: [...s.connections.values()].sort((a, b) => a.appName.localeCompare(b.appName) || a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function afterSystems(today: SystemsMap, after: SystemsMap): BeforeAfterSystem[] {
  const out: BeforeAfterSystem[] = [];
  const ids = new Set([...today.keys(), ...after.keys()]);
  for (const id of ids) {
    const before = today.get(id);
    const now = after.get(id);
    if (before && !now) {
      out.push({ id, name: before.name, mark: 'ends', connections: [...before.connections.values()] });
      continue;
    }
    if (!now) continue;
    const connections: BeforeAfterConnection[] = [];
    for (const c of now.connections.values()) connections.push({ ...c, mark: before && !before.connections.has(c.key) ? 'new' : before ? 'same' : 'new' });
    if (before) for (const c of before.connections.values()) if (!now.connections.has(c.key)) connections.push({ ...c, mark: 'ends' });
    connections.sort((a, b) => a.appName.localeCompare(b.appName) || a.label.localeCompare(b.label));
    out.push({ id, name: now.name, mark: before ? 'same' : 'new', connections });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param today The live model's head (main).
 * @param changes The project's open changes, each folded to its own head.
 * @param capabilities The capabilities in the project's declared scope.
 */
export function buildProjectBeforeAfter(today: Head, changes: readonly BeforeAfterChange[], capabilities: readonly { id: UUID; name: string }[], now: Date = new Date()): BeforeAfterCapability[] {
  const todayView = viewOf(today);
  const changeViews = changes.map((c) => ({ change: c, view: viewOf(c.head) }));
  return capabilities
    .map((capability) => {
      const before = systemsIn(todayView, capability.id, now);
      return {
        id: capability.id,
        name: capability.name,
        today: { changeId: null, title: 'Today', systems: toSystems(before) },
        after: changeViews.map(({ change, view }) => ({ changeId: change.id, title: `After: ${change.title}`, systems: afterSystems(before, systemsIn(view, capability.id, now)) })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
