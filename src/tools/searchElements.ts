import { z } from 'zod';
import { ELEMENT_TYPES } from '../contracts/delta';
import { countMatches, matchElements, type SearchPoolElement } from '../db/elementSearch';
import { DEFAULT_TOOL_ROWS, MAX_QUERY_CHARS, MAX_TOOL_ROWS } from './limits';
import { defineTool, elementRef, indexSnapshot, okResult } from './toolKit';

const schema = z.strictObject({
  query: z.string().trim().min(2, 'give at least 2 characters').max(MAX_QUERY_CHARS),
  type: z.enum(ELEMENT_TYPES).optional(),
  limit: z.number().int().min(1).max(MAX_TOOL_ROWS).default(DEFAULT_TOOL_ROWS),
});

export const searchElements = defineTool({
  name: 'search_elements',
  description: 'Find elements by name or alias (a close match is enough). Returns each match\'s id, type and name; use get_element for detail. Optionally restrict to one element type.',
  schema,
  run: async (ctx, input) => {
    const snapshot = await ctx.snapshot();
    const index = indexSnapshot(snapshot);
    const pool: SearchPoolElement[] = snapshot.elements
      .filter((e) => input.type === undefined || e.element_type === input.type)
      .map((element) => ({ element, aliases: [...(snapshot.aliases.get(element.element_id) ?? [])] }));
    const total = countMatches(pool, input.query);
    const matches = matchElements(pool, input.query, input.limit);
    return okResult(ctx, { matches: matches.map((e) => elementRef(index, e)) }, total, total > matches.length);
  },
});
