/**
 * Small helpers every tool uses: defining a tool from a validator, turning a
 * validation failure into a plain error the assistant can act on, and the
 * shared, memoised view of a snapshot (elements by id, who owns what, edges
 * by endpoint) so no tool rebuilds it.
 */
import { z } from 'zod';
import type { UUID } from '../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../contracts/rows';
import { ownersByElementIdFromOwnsEdges, type BrowseRow } from '../db/elementBrowse';
import { buildBrowseRows } from '../engine/elementRead/buildBrowseRows';
import { moduleDisplayName } from '../engine/elementRead/moduleDisplayName';
import { clip } from './limits';
import type { ModelSnapshot, ModelTool, ToolContext, ToolResult } from './types';

export function defineTool<S extends z.ZodType>(def: { name: string; description: string; schema: S; run: (ctx: ToolContext, input: z.output<S>) => Promise<ToolResult> }): ModelTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: z.toJSONSchema(def.schema),
    run: async (ctx, input) => {
      const parsed = def.schema.safeParse(input ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : 'input'}: ${i.message}`);
        return { ok: false, error: clip(`Invalid input for ${def.name}. ${issues.join('; ')}`, 400) };
      }
      return def.run(ctx, parsed.data);
    },
  };
}

export function okResult(ctx: ToolContext, data: unknown, total: number | null = null, truncated = false): ToolResult {
  return { ok: true, stamp: ctx.stamp, data, total, truncated };
}

export function failure(error: string): ToolResult {
  return { ok: false, error };
}

export const uuidInput = z.uuid({ error: 'must be an element id returned by another tool' });

export interface SnapshotIndex {
  byId: ReadonlyMap<UUID, ElementsHeadRow>;
  browse: readonly BrowseRow[];
  browseById: ReadonlyMap<UUID, BrowseRow>;
  /** Every edge touching an element, by element id (an edge appears under both ends). */
  edgesByElement: ReadonlyMap<UUID, readonly RelationshipsHeadRow[]>;
}

const cache = new WeakMap<ModelSnapshot, SnapshotIndex>();

export function indexSnapshot(snapshot: ModelSnapshot): SnapshotIndex {
  const hit = cache.get(snapshot);
  if (hit) return hit;
  const byId = new Map<UUID, ElementsHeadRow>(snapshot.elements.map((e) => [e.element_id, e]));
  const owners = ownersByElementIdFromOwnsEdges(
    snapshot.relationships.filter((r) => r.relationship_type === 'owns'),
    byId,
  );
  const browse = buildBrowseRows(snapshot.elements, owners);
  const edges = new Map<UUID, RelationshipsHeadRow[]>();
  const push = (id: UUID, edge: RelationshipsHeadRow) => {
    const list = edges.get(id);
    if (list) list.push(edge);
    else edges.set(id, [edge]);
  };
  for (const edge of snapshot.relationships) {
    push(edge.from_element_id, edge);
    if (edge.to_element_id !== edge.from_element_id) push(edge.to_element_id, edge);
  }
  const index: SnapshotIndex = { byId, browse, browseById: new Map(browse.map((r) => [r.element.element_id, r])), edgesByElement: edges };
  cache.set(snapshot, index);
  return index;
}

/** The name a person would call an element: a module reads "Platform · Module". Clipped, since names are free text. */
export function displayNameOf(index: SnapshotIndex, element: ElementsHeadRow): string {
  const parent = element.parent_id !== null ? (index.byId.get(element.parent_id) ?? null) : null;
  return clip(moduleDisplayName(element, parent), 200);
}

export interface ElementRef {
  id: UUID;
  type: string;
  name: string;
}

export function elementRef(index: SnapshotIndex, element: ElementsHeadRow): ElementRef {
  return { id: element.element_id, type: element.element_type, name: displayNameOf(index, element) };
}
