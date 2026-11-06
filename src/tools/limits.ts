/**
 * ADR-028 §1: the bounds every model tool keeps. A tool never returns an
 * unbounded list or an unbounded string; when it cuts something it says so
 * (`truncated`, plus the true `total`), so the assistant can tell a person
 * "showing 50 of 212" instead of presenting a partial list as everything.
 */
export const MAX_TOOL_ROWS = 50;
export const DEFAULT_TOOL_ROWS = 20;
export const MAX_RELATIONSHIPS = 50;
export const DEFAULT_RELATIONSHIPS = 20;
export const MAX_TEXT_CHARS = 500;
export const MAX_ATTRIBUTES = 40;
export const MAX_QUERY_CHARS = 200;
export const MAX_FILTERS = 10;
export const MAX_COLUMNS = 8;

/** Cuts text to the limit, marking the cut. Control characters (other than newline and tab) are dropped: model text is data, and a stray control sequence has no place in it. */
export function clip(text: string, max: number = MAX_TEXT_CHARS): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point.
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return clean.length <= max ? clean : `${clean.slice(0, max)}… (cut at ${String(max)} characters)`;
}
