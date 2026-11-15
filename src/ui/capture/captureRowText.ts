/**
 * Small, pure wording decisions for one import review row, so they can be
 * tested without rendering. Display only: nothing here changes how the
 * importer matches or classifies anything.
 */

/** Lower-cased, single-spaced, trimmed: "  SAP  PM " and "sap pm" are the same name. */
export function sameName(a: string, b: string): boolean {
  const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return normal(a) === normal(b);
}

/**
 * The names the row would be "recognised" by next time, minus any that just
 * repeat a name the row already shows (its own name, or the element it matched).
 * Empty means the "We'll recognise …" line has nothing to add and is not shown.
 */
export function newAliasValues(aliasValues: readonly string[], namesAlreadyShown: readonly string[]): string[] {
  return aliasValues.filter((value) => !namesAlreadyShown.some((name) => sameName(value, name)));
}
