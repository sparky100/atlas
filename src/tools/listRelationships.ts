import { z } from 'zod';
import { RELATIONSHIP_TYPES } from '../contracts/delta';
import type { Json } from '../contracts/rows';
import { attributesRecord } from '../engine/elementRead/attributesRecord';
import { edgesInForce } from '../engine/elementRead/fitAndExposure';
import { clip, DEFAULT_RELATIONSHIPS, MAX_RELATIONSHIPS } from './limits';
import { defineTool, elementRef, failure, indexSnapshot, okResult, uuidInput } from './toolKit';

const schema = z.strictObject({
  elementId: uuidInput,
  type: z.enum(RELATIONSHIP_TYPES).optional(),
  direction: z.enum(['from', 'to', 'both']).default('both'),
  includePlannedAndRetired: z.boolean().default(false),
  limit: z.number().int().min(1).max(MAX_RELATIONSHIPS).default(DEFAULT_RELATIONSHIPS),
});

/** Today's links only, unless the caller asks for planned and retired ones too. */
function edgesInForceUnless<T extends Parameters<typeof edgesInForce>[0][number]>(all: boolean, edges: readonly T[], byId: Parameters<typeof edgesInForce>[1], now: Date): T[] {
  return all ? [...edges] : (edgesInForce(edges, byId, now) as T[]);
}

function scalar(value: Json | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return clip(value, 200);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return clip(JSON.stringify(value), 200);
}

export const listRelationships = defineTool({
  name: 'list_relationships',
  description: 'The relationships of one element (supports, uses, owns, flows_to, replaces, enables), each with the element at the other end. "from" means this element is the source, "to" means it is the target. Optionally filter by relationship type. Like the app\'s views of today, a link counts only when both ends are active, so links to planned or retired systems are left out unless "includePlannedAndRetired" is true.',
  schema,
  run: async (ctx, input) => {
    const snapshot = await ctx.snapshot();
    const index = indexSnapshot(snapshot);
    const self = index.byId.get(input.elementId);
    if (!self) return failure('No element with that id in this model.');
    const byId = new Map(snapshot.elements.map((e) => [e.element_id, e]));
    const edges = edgesInForceUnless(input.includePlannedAndRetired, index.edgesByElement.get(self.element_id) ?? [], byId, ctx.now())
      .filter((e) => input.type === undefined || e.relationship_type === input.type)
      .filter((e) => input.direction === 'both' || (input.direction === 'from' ? e.from_element_id === self.element_id : e.to_element_id === self.element_id))
      .sort((a, b) => a.relationship_type.localeCompare(b.relationship_type) || a.relationship_id.localeCompare(b.relationship_id));
    const shown = edges.slice(0, input.limit).flatMap((edge) => {
      const outgoing = edge.from_element_id === self.element_id;
      const other = index.byId.get(outgoing ? edge.to_element_id : edge.from_element_id);
      if (!other) return [];
      const attrs = attributesRecord(edge.attributes);
      return [
        {
          relationshipId: edge.relationship_id,
          type: edge.relationship_type,
          direction: outgoing ? 'from' : 'to',
          other: elementRef(index, other),
          attributes: Object.fromEntries(Object.entries(attrs).slice(0, 10).map(([k, v]) => [k, scalar(v)])),
        },
      ];
    });
    return okResult(ctx, { relationships: shown }, edges.length, edges.length > shown.length);
  },
});
