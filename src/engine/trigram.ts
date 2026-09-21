/**
 * Pure-TypeScript trigram similarity — SPEC §8 point 3's own threshold
 * (≥ 0.6), reimplemented here because `classifyMerge` (E7,
 * docs/prompts/atlas-prompt-pack.md) compares two already-folded, in-memory
 * `Head`s with no database round trip available to it; `elements_head_name_trgm_idx`
 * (§3.5) and Postgres's own `pg_trgm.similarity()` remain the real matching
 * path once the capture pipeline (Sprint K1) exists and can afford a query
 * per candidate. Matches `pg_trgm`'s own trigram extraction: NOT a single
 * padded slide across the whole string (found live, P-K2's own real-Postgres
 * comparison: `show_trgm('a  b')` and `show_trgm('a!b')` both equal
 * `show_trgm('a b')` exactly) — pg_trgm first splits the string into
 * "words" at every run of one or more non-alphanumeric characters
 * (`show_trgm('!!!')`/`show_trgm('  ')` are both `{}`, no words at all),
 * pads *each word* with two leading spaces and one trailing space, and
 * unions every word's own trigrams into one set. Its similarity formula is
 * the Jaccard index of the two trigram sets (shared trigrams over the
 * union), so the ≥ 0.6 threshold means the same thing here as it will once
 * §8's own capture matcher calls the real Postgres function against the
 * same names.
 */
function wordsOf(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
}

function trigramsOf(value: string): Set<string> {
  const trigrams = new Set<string>();
  for (const word of wordsOf(value)) {
    const padded = `  ${word} `;
    for (let i = 0; i <= padded.length - 3; i += 1) trigrams.add(padded.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * 0 (nothing shared) to 1 (identical) — symmetric. Two textually equal
 * strings naturally score 1 whenever they contain at least one word (equal
 * non-empty trigram sets make `shared === union`); no `a === b` shortcut is
 * needed for that case, and one used to be here, which was actually wrong
 * for the zero-word case — Postgres's own `similarity('*', '*')` and
 * `similarity('', '')` are both `0`, not `1` (confirmed live against
 * `pg_trgm`): a name with no alphanumeric characters at all has an empty
 * trigram set, and an empty-over-empty union is defined as 0 similarity
 * even when the two source strings are byte-identical.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** SPEC §8 point 3's own value — the one place this number is defined; every caller (the classifier, eventually the capture matcher) imports it rather than repeating the literal. */
export const IDENTITY_TRIGRAM_THRESHOLD = 0.6;
