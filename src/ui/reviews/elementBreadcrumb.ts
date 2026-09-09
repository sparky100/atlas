import type { UUID } from '../../contracts/delta';
import type { Head } from '../../engine/deltas';

/**
 * A field-conflict card's own small "element name, type, breadcrumb (parent
 * chain)" (SPEC §7.4) — walks `parentId` in the already-folded `head`
 * (either side of the three-way diff has every ancestor, since a subject's
 * structural position doesn't change independently per side in a way this
 * card needs to distinguish). Not src/ui/nav's breadcrumb component: that
 * one renders the page-level `Org › Model › [ref] › ...` chain from live
 * queries; this is a plain string for inside a card, built from a `Head`
 * this page already has in memory.
 */
export function elementBreadcrumb(head: Head, elementId: UUID): string {
  const names: string[] = [];
  let currentId: UUID | null = elementId;
  const seen = new Set<UUID>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const row = head.elements.get(currentId);
    if (!row) break;
    names.unshift(row.name);
    currentId = row.parentId;
  }
  return names.join(' › ');
}

/**
 * Which comment anchor kind a conflict/clean-change finding's own
 * `subjectId` is (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s 6b section)
 * — `ConflictFinding.subjectId` is generically a `UUID` (`src/engine/merge.ts`),
 * naming either an element or a relationship depending on which one the
 * finding is actually about; `comments.anchor_type` needs to know which.
 * Same lookup order as `subjectName` below, so the two never disagree
 * about what a given id is.
 */
export function subjectAnchorType(heads: readonly Head[], subjectId: UUID): 'element' | 'relationship' {
  for (const head of heads) {
    if (head.elements.has(subjectId)) return 'element';
    if (head.relationships.has(subjectId)) return 'relationship';
  }
  return 'element';
}

/** The subject's own display name — an element's name, or "`type` A → B" for a relationship — from whichever side of the diff still has it. */
export function subjectName(heads: readonly Head[], subjectId: UUID): string {
  for (const head of heads) {
    const el = head.elements.get(subjectId);
    if (el) return el.name;
    const rel = head.relationships.get(subjectId);
    if (rel) {
      const from = heads.map((h) => h.elements.get(rel.fromElementId)?.name).find((n) => n !== undefined);
      const to = heads.map((h) => h.elements.get(rel.toElementId)?.name).find((n) => n !== undefined);
      return `${rel.relationshipType} ${from ?? rel.fromElementId} → ${to ?? rel.toElementId}`;
    }
  }
  return subjectId;
}
