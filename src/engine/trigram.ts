/**
 * Pure-TypeScript trigram similarity — SPEC §8 point 3's own threshold
 * (≥ 0.6), reimplemented here because `classifyMerge` (E7,
 * docs/prompts/atlas-prompt-pack.md) compares two already-folded, in-memory
 * `Head`s with no database round trip available to it; `elements_head_name_trgm_idx`
 * (§3.5) and Postgres's own `pg_trgm.similarity()` remain the real matching
 * path once the capture pipeline (Sprint K1) exists and can afford a query
 * per candidate. Matches `pg_trgm`'s own trigram extraction exactly (two
 * leading spaces, one trailing space, then every consecutive 3-character
 * slice) and its similarity formula (the Jaccard index of the two trigram
 * sets: shared trigrams over the union), so the ≥ 0.6 threshold means the
 * same thing here as it will once §8's own capture matcher calls the real
 * Postgres function against the same names.
 */
function trigramsOf(value: string): Set<string> {
  const padded = `  ${value} `;
  const trigrams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i += 1) trigrams.add(padded.slice(i, i + 3));
  return trigrams;
}

/** 0 (nothing shared) to 1 (identical) — symmetric, and 1 for two equal strings including two empty ones. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** SPEC §8 point 3's own value — the one place this number is defined; every caller (the classifier, eventually the capture matcher) imports it rather than repeating the literal. */
export const IDENTITY_TRIGRAM_THRESHOLD = 0.6;
