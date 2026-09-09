/** One rendered span of a comment body: plain text, or an `@handle` mention. */
export type CommentBodySpan = { kind: 'text'; text: string } | { kind: 'mention'; handle: string };

/**
 * Splits a comment body into plain-text and `@handle` spans for rendering
 * (Sprint M1b: "@mentions render as accent-weighted text"). Same `@handle`
 * pattern as `parseMentionHandles`/`atlas.process_comment_mentions` — this
 * renders every syntactic mention as accent-weighted, whether or not it
 * resolved to a real member server-side (the same "known, accepted
 * behaviour" `parseMentionHandles`' own test documents for an email's
 * domain half — rendering is cosmetic, not a second resolution pass).
 */
export function splitMentionSpans(body: string): CommentBodySpan[] {
  const spans: CommentBodySpan[] = [];
  const pattern = /@([a-zA-Z0-9_-]+)/g;
  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index;
    if (index > lastIndex) spans.push({ kind: 'text', text: body.slice(lastIndex, index) });
    spans.push({ kind: 'mention', handle: match[1] ?? '' });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) spans.push({ kind: 'text', text: body.slice(lastIndex) });
  return spans;
}
