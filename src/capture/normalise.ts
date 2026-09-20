/**
 * F2 (full K1), SPEC-capture.md §7.2: capture's own name normaliser — feeds
 * alias lookup, trigram similarity and intra-document grouping (§5.2). The
 * *only* normaliser capture uses; `src/engine/merge.ts`'s `normalizeName`
 * (trim + lowercase) stays exactly as-is — the merge classifier's identity
 * check is deliberately exact, this one is deliberately looser.
 */
export function normaliseName(value: string): string {
  let s = value.normalize('NFKC').toLowerCase();
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/&/g, 'and');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  if (s.startsWith('the ')) s = s.slice(4);
  return s;
}
