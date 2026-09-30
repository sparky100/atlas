/**
 * F2 (full K1) PR11, SPEC-capture.md §5.3 "Grounding (code)": every fact a
 * prose extraction (prompt B) returns must have its own `passage` verified
 * against the chunk text it actually came from — byte-exact match is
 * confidence factor 1.0; a match found only after normalising case,
 * whitespace, quotes, hyphens and dashes is 0.85 with `PASSAGE_NORMALISED`;
 * and a match found only as a *word subsequence* (a multi-column PDF whose
 * extracted text interleaves the columns — every word of the passage is
 * there, in order, but with other text between them) is also 0.85. No match
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
const DASHES = new Set(['–', '—']); // en dash, em dash — folded to whitespace below, exactly like a hyphen.

/**
 * One pass, one output character (or none) per input character: whitespace
 * runs collapse to a single space, hyphens and en/em dashes fold to a space
 * (the model often drops or adds a hyphen — "industry-leading" ↔ "industry
 * leading" — and a PDF line-break hyphenates a word as "Pre-\nApplication"
 * where the model correctly reads "Pre-Application"), letters case-fold to
 * lowercase, curly quotes straighten. `indexMap[i]` is the original-text
 * index the normalised string's own character `i` came from, so
 * `indexMap[matchStart]` and `indexMap[matchEnd - 1] + 1` recover the
 * original span of any match found in the normalised string.
 */
function normaliseForGrounding(text: string): { normalised: string; indexMap: number[] } {
  const chars: string[] = [];
  const indexMap: number[] = [];
  let previousWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch) || ch === '-' || DASHES.has(ch)) {
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
    else chars.push(ch.toLowerCase());
    indexMap.push(i);
  }

  return { normalised: chars.join(''), indexMap };
}

/**
 * Word-subsequence fallback for multi-column PDFs: their extracted text
 * interleaves the columns, so a sentence's words survive in order but with
 * other text threaded between them — the contiguous `indexOf` above then
 * fails even though the passage is genuinely there. Matches the passage's
 * words as a *subsequence* of the haystack's words (every word present, in
 * order, gaps allowed). `null` for a passage too short to trust this way
 * (a few words could coincide anywhere).
 */
function wordSubsequenceMatch(normalisedHaystack: string, normalisedPassage: string, indexMap: number[]): GroundResult | null {
  // Word identity ignores surrounding punctuation ("registered." ≈
  // "registered", "(CLM)" ≈ "clm") but keeps internal punctuation ("6,500"
  // stays one token) — only the leading/trailing punctuation the model (and
  // sentence context) attaches or drops varies.
  const stripWordPunctuation = (word: string): string => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');

  // Tokenise the normalised haystack into words with their normalised char ranges.
  const haystackWords: { word: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < normalisedHaystack.length) {
    if (normalisedHaystack[i] === ' ') {
      i++;
      continue;
    }
    const start = i;
    while (i < normalisedHaystack.length && normalisedHaystack[i] !== ' ') i++;
    const word = stripWordPunctuation(normalisedHaystack.slice(start, i));
    if (word !== '') haystackWords.push({ word, start, end: i });
  }

  const passageWords = normalisedPassage.split(' ').map(stripWordPunctuation).filter((w) => w !== '');
  if (passageWords.length < 4) return null;

  let h = 0;
  let first: { start: number; end: number } | null = null;
  let last: { start: number; end: number } | null = null;
  for (const passageWord of passageWords) {
    let matched = false;
    for (let k = h; k < haystackWords.length; k++) {
      const candidate = haystackWords[k];
      if (candidate?.word === passageWord) {
        first ??= candidate;
        last = candidate;
        h = k + 1;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }

  if (first === null || last === null) return null;
  const start = indexMap[first.start];
  const lastCharIndex = indexMap[last.end - 1];
  if (start === undefined || lastCharIndex === undefined) return null;
  return { found: true, normalised: true, start, end: lastCharIndex + 1 };
}

/** §5.3: byte-exact first, then case/whitespace/quote/dash-normalised (contiguous), then word-subsequence (multi-column) — never anything looser (rule 7: a fact with no real passage is dropped, not guessed at). */
export function groundPassage(haystack: string, passage: string): GroundResult {
  if (passage === '') return NOT_FOUND;

  const exactIndex = haystack.indexOf(passage);
  if (exactIndex !== -1) return { found: true, normalised: false, start: exactIndex, end: exactIndex + passage.length };

  const { normalised: normalisedHaystack, indexMap } = normaliseForGrounding(haystack);
  const { normalised: normalisedPassage } = normaliseForGrounding(passage);
  if (normalisedPassage === '') return NOT_FOUND;

  const normalisedIndex = normalisedHaystack.indexOf(normalisedPassage);
  if (normalisedIndex !== -1) {
    const start = indexMap[normalisedIndex];
    const lastCharIndex = indexMap[normalisedIndex + normalisedPassage.length - 1];
    if (start !== undefined && lastCharIndex !== undefined) return { found: true, normalised: true, start, end: lastCharIndex + 1 };
  }

  return wordSubsequenceMatch(normalisedHaystack, normalisedPassage, indexMap) ?? NOT_FOUND;
}
