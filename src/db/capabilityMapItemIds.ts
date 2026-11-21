/** An existing starter-map item, as the loader reads it before replacing a draft. */
export interface ExistingCapabilityMapItem {
  id: string;
  code: string;
}

export interface CapabilityMapItemIdPlan {
  /** The id each code in the file should use: the existing one, or a fresh id for a new code. */
  idByCode: ReadonlyMap<string, string>;
  /** Existing rows whose code is no longer in the file. */
  removedIds: readonly string[];
}

/**
 * Keeps a draft reload from breaking the capabilities seeded from it. The
 * capability stores the item id as `templateRef`, so deleting and re-inserting
 * items under fresh ids makes every seeded capability point at nothing. Reuse
 * the id for a code that is still present; only remove a code that really went.
 */
export function planCapabilityMapItemIds(
  existing: readonly ExistingCapabilityMapItem[],
  codes: readonly string[],
  newId: () => string = () => crypto.randomUUID(),
): CapabilityMapItemIdPlan {
  const existingIdByCode = new Map(existing.map((item) => [item.code, item.id]));
  const wanted = new Set(codes);
  const idByCode = new Map<string, string>();
  for (const code of codes) idByCode.set(code, existingIdByCode.get(code) ?? newId());
  return { idByCode, removedIds: existing.filter((item) => !wanted.has(item.code)).map((item) => item.id) };
}
