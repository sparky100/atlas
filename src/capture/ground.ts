/**
 * F2 (full K1) PR11, SPEC-capture.md §5.3 "Grounding (code)": every fact a
 * prose extraction (prompt B) returns must have its own `passage` verified
 * against the chunk text it actually came from — byte-exact match is
 * confidence factor 1.0; a match found only after normalising case,
 * whitespace, quotes and dashes is 0.85 with `PASSAGE_NORMALISED`; no match
 * at all means the fact never happened, never a guess at where it might be.
 *
 * The normalised search still has to report a real offset into the
 * *original* text (so `sourceRef` — §4.1's `pdf:p{page}!{start}-{end}` /
 * `text:{start}-{end}` — can be computed from where the passage was found,
 * never from what the model claims): `normaliseForGrounding` builds the
 * normalised string one output character at a time, recording which
 * original-text index produced it, so a match position in normalised
 * co-ordinates translates back to the exact original span it came from —
 * not an approximation.
 */

export interface GroundResult {
  found: boolean;
  /** `true` only when the match needed normalisation to be found — `PASSAGE_NORMALISED`, confidence factor 0.85 (§5.5's own `groundingFactor`). */
  normalised: boolean;
  /** Offsets into the *original* (un-normalised) text passed to `groundPassage` — meaningless when `found` is `false`. */
  start: number;
  end: number;
}

const NOT_FOUND: GroundResult = { found: false, normalised: false, start: -1, end: -1 };

const CURLY_DOUBLE_QUOTES = new Set(['“', '”']);
const CURLY_SINGLE_QUOTES = new Set(['‘', '’']);
const DASHES = new Set(['–', '—']); // en dash, em dash

/**
 * One pass, one output character (or none) per input character: whitespace
 * runs collapse to a single space, letters case-fold to lowercase (the model
 * commonly re-cases a passage it otherwise copied verbatim — e.g. title case
 * for a sentence-case source), curly quotes straighten, en/em dashes become a
 * hyphen. `indexMap[i]` is the original-text index the normalised string's
 * own character `i` came from, so `indexMap[matchStart]` and
 * `indexMap[matchEnd - 1] + 1` recover the original span of any match found
 * in the normalised string.
 */
function normaliseForGrounding(text: string): { normalised: string; indexMap: number[] } {
  const chars: string[] = [];
  const indexMap: number[] = [];
  let previousWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      if (!previousWasSpace) {
        chars.push(' ');
        indexMap.push(i);
      }
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    if (CURLY_DOUBLE_QUOTES.has(ch)) chars.push('"');
    else if (CURLY_SINGLE_QUOTES.has(ch)) chars.push("'");
    else if (DASHES.has(ch)) chars.push('-');
    else chars.push(ch.toLowerCase());
    indexMap.push(i);
  }

  return { normalised: chars.join(''), indexMap };
}

/** §5.3: byte-exact first, then case/whitespace/quote/dash-normalised — never anything looser (rule 7: a fact with no real passage is dropped, not guessed at). */
export function groundPassage(haystack: string, passage: string): GroundResult {
  if (passage === '') return NOT_FOUND;

  const exactIndex = haystack.indexOf(passage);
  if (exactIndex !== -1) return { found: true, normalised: false, start: exactIndex, end: exactIndex + passage.length };

  const { normalised: normalisedHaystack, indexMap } = normaliseForGrounding(haystack);
  const { normalised: normalisedPassage } = normaliseForGrounding(passage);
  if (normalisedPassage === '') return NOT_FOUND;

  const normalisedIndex = normalisedHaystack.indexOf(normalisedPassage);
  if (normalisedIndex === -1) return NOT_FOUND;

  const start = indexMap[normalisedIndex];
  const lastCharIndex = indexMap[normalisedIndex + normalisedPassage.length - 1];
  if (start === undefined || lastCharIndex === undefined) return NOT_FOUND;
  return { found: true, normalised: true, start, end: lastCharIndex + 1 };
}
