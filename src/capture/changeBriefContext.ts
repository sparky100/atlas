import type { Head } from '../engine/deltas';
import { normaliseName } from './normalise';

const MAX_CONTEXT_ELEMENTS = 30;
const MAX_CONTEXT_RELATIONSHIPS = 30;

export function buildChangeBriefContext(brief: string, head: Head) {
  const briefWords = ` ${normaliseName(brief)} `;
  const mentioned = [...head.elements].filter(([, element]) => {
    const name = normaliseName(element.name);
    return name.length > 0 && briefWords.includes(` ${name} `);
  });
  const selected = mentioned.slice(0, MAX_CONTEXT_ELEMENTS);
  const ids = new Set(selected.map(([id]) => id));
  const relationships = [...head.relationships.values()].filter((edge) => ids.has(edge.fromElementId) && ids.has(edge.toElementId));

  return {
    elements: selected.map(([, element]) => ({
      name: element.name.slice(0, 200),
      type: element.elementType,
      parent: element.parentId ? head.elements.get(element.parentId)?.name.slice(0, 200) : undefined,
    })),
    relationships: relationships.slice(0, MAX_CONTEXT_RELATIONSHIPS).map((edge) => ({
      type: edge.relationshipType,
      from: head.elements.get(edge.fromElementId)?.name.slice(0, 200),
      to: head.elements.get(edge.toElementId)?.name.slice(0, 200),
    })),
    truncated: mentioned.length > selected.length || relationships.length > MAX_CONTEXT_RELATIONSHIPS,
  };
}
