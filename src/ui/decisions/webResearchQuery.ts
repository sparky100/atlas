/** The same limits the research-agent enforces; the UI checks first for a plain sentence. */
export const WEB_RESEARCH_QUERY_MIN = 3;
export const WEB_RESEARCH_QUERY_MAX = 300;

/**
 * A query is one line of the person's own words. Control characters are
 * refused, not silently removed, because the text the person approves is the
 * text that is sent.
 */
export function researchQueryProblem(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length < WEB_RESEARCH_QUERY_MIN) return 'Write at least a few words to search for.';
  if (trimmed.length > WEB_RESEARCH_QUERY_MAX) return `Keep the query to ${String(WEB_RESEARCH_QUERY_MAX)} characters or fewer.`;
  for (const character of trimmed) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return 'Keep the query to one line.';
  }
  return null;
}
