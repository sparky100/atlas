import { z } from 'zod';
import type { Json } from '../contracts/rows';
import { attributesRecord } from '../engine/elementRead/attributesRecord';
import { clip, DEFAULT_RELATIONSHIPS, MAX_ATTRIBUTES } from './limits';
import { defineTool, displayNameOf, elementRef, failure, indexSnapshot, okResult, uuidInput } from './toolKit';

const schema = z.strictObject({ elementId: uuidInput });

function plain(value: Json | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return clip(JSON.stringify(value));
}

export const getElement = defineTool({
  name: 'get_element',
  description: 'Everything recorded about one element: its type, name, parent, owner, lifecycle, criticality, disposition, attributes (with where each came from and how sure we are), and a count of its relationships. Use list_relationships for the relationships themselves.',
  schema,
  run: async (ctx, input) => {
    const snapshot = await ctx.snapshot();
    const index = indexSnapshot(snapshot);
    const row = index.browseById.get(input.elementId);
    if (!row) return failure('No element with that id in this model.');
    const { element } = row;
    const facts = await ctx.factsFor(element.element_id);
    const provenance = new Map(facts.map((f) => [f.attribute, { source: f.source_ref !== null ? clip(f.source_ref, 200) : f.source_id, confidence: f.confidence, asOf: f.effective_date }]));
    const attributes = Object.entries(attributesRecord(element.attributes))
      .slice(0, MAX_ATTRIBUTES)
      .map(([key, value]) => ({ attribute: key, value: plain(value), ...(provenance.get(key) !== undefined ? { provenance: provenance.get(key) } : {}) }));
    const edges = index.edgesByElement.get(element.element_id) ?? [];
    const byType: Record<string, number> = {};
    for (const edge of edges) byType[edge.relationship_type] = (byType[edge.relationship_type] ?? 0) + 1;
    const children = snapshot.elements.filter((e) => e.parent_id === element.element_id);
    return okResult(ctx, {
      ...elementRef(index, element),
      ownName: clip(element.name, 200),
      parent: row.parent ? elementRef(index, row.parent) : null,
      owner: row.owner ? elementRef(index, row.owner) : null,
      lifecycle: row.lifecycleStatus,
      criticality: row.criticality,
      disposition: row.disposition,
      aliases: (snapshot.aliases.get(element.element_id) ?? []).slice(0, 20).map((a) => clip(a, 200)),
      attributes,
      attributesTruncated: Object.keys(attributesRecord(element.attributes)).length > MAX_ATTRIBUTES,
      relationshipCounts: byType,
      relationshipTotal: edges.length,
      relationshipsHint: edges.length > DEFAULT_RELATIONSHIPS ? 'Many relationships; use list_relationships with a type to narrow them.' : undefined,
      children: children.slice(0, 20).map((c) => ({ id: c.element_id, type: c.element_type, name: displayNameOf(index, c) })),
      childrenTotal: children.length,
    });
  },
});
