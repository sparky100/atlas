/**
 * Pure logic for the composer's @mention autocomplete (Sprint M1b) — no
 * DOM, no I/O, testable without a browser. The charset mirrors
 * `atlas.process_comment_mentions`'/`parseMentionHandles`'s own handle
 * pattern (`[a-zA-Z0-9_-]`), so what this offers to autocomplete is always
 * a token the server would actually resolve.
 */

/**
 * The partial handle text being typed right before the cursor, or `null`
 * when the cursor isn't inside an `@token` at all (a bare `@` with nothing
 * after it still counts — an empty-string query, not `null`, so the
 * autocomplete opens the moment `@` is typed). Only ever looks at the
 * *word* immediately before the cursor: a mention must start at a word
 * boundary (start of string, or after whitespace) so an email's domain
 * half (`alex@example.com`) never opens the autocomplete mid-word — a
 * deliberately narrower rule than `parseMentionHandles`' own (which
 * matches `@example` in that same string for the *server-side* parse,
 * documented as known, accepted behaviour there). Autocomplete UX and
 * what the server ultimately resolves are allowed to differ this one way:
 * a strict trigger avoids the autocomplete popping open constantly while
 * someone types a normal email address, without changing what a body
 * that's actually posted will notify.
 */
export function activeMentionQuery(body: string, cursorIndex: number): string | null {
  const before = body.slice(0, cursorIndex);
  const match = /(?:^|\s)@([a-zA-Z0-9_-]*)$/.exec(before);
  return match ? (match[1] ?? '') : null;
}

export interface MentionInsertion {
  body: string;
  /** Where to place the cursor after the insertion — right after the trailing space, ready to keep typing. */
  cursorIndex: number;
}

/** Replaces the partial `@token` ending at `cursorIndex` with `@handle `, the same "pick a result, keep typing" shape `ElementSearchAdd`'s own search results use. */
export function insertMention(body: string, cursorIndex: number, handle: string): MentionInsertion {
  const before = body.slice(0, cursorIndex);
  const after = body.slice(cursorIndex);
  const match = /(?:^|\s)@([a-zA-Z0-9_-]*)$/.exec(before);
  if (!match) return { body, cursorIndex };
  const tokenStart = before.length - match[0].length + (match[0].startsWith('@') ? 0 : 1);
  const inserted = `@${handle} `;
  const nextBody = before.slice(0, tokenStart) + inserted + after;
  return { body: nextBody, cursorIndex: tokenStart + inserted.length };
}
