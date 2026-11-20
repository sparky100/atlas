/** What still blocks closing a project, ordered the way people think about it: each open decision first, then the changes that are its options, then changes that belong to no decision. */
export interface OpenWorkGroup<D, C> {
  decision: D;
  changes: C[];
}

export interface OpenWorkOrder<D, C> {
  groups: OpenWorkGroup<D, C>[];
  standalone: C[];
}

export function orderOpenWork<D extends { id: string }, C extends { id: string }>(
  decisions: readonly D[],
  changes: readonly C[],
  links: readonly { decisionId: string; branchId: string }[],
): OpenWorkOrder<D, C> {
  const decisionOf = new Map<string, string>();
  for (const l of links) if (!decisionOf.has(l.branchId)) decisionOf.set(l.branchId, l.decisionId);
  const shown = new Set(decisions.map((d) => d.id));
  const groups = decisions.map((decision) => ({ decision, changes: changes.filter((c) => decisionOf.get(c.id) === decision.id) }));
  // An option whose decision is no longer open (or not listed) is still listed, but on its own.
  const standalone = changes.filter((c) => {
    const d = decisionOf.get(c.id);
    return d === undefined || !shown.has(d);
  });
  return { groups, standalone };
}
