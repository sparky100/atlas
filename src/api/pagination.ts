/**
 * Cursor paging for the read-only API. Rows are always ordered by id, so a
 * cursor is just "the last id you saw", wrapped so clients treat it as
 * opaque. Stable while the model is unchanged; if a row is added or removed
 * between pages the walk neither repeats nor skips any row it had not
 * already passed.
 */
import { API_DEFAULT_PAGE_LIMIT, API_MAX_PAGE_LIMIT, type ApiPage } from '../contracts/api';

export function encodeCursor(afterId: string): string {
  return btoa(JSON.stringify({ after: afterId })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The id after which to continue (`null` value for the first page), or not ok when the cursor is not one we issued. */
export type Decoded<T> = { ok: true; value: T } | { ok: false };
export function decodeCursor(cursor: string | null): Decoded<string | null> {
  if (cursor === null || cursor === '') return { ok: true, value: null };
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { after?: unknown }).after === 'string') return { ok: true, value: (parsed as { after: string }).after };
  } catch {
    // fall through
  }
  return { ok: false };
}

export function parseLimit(raw: string | null): number | null {
  if (raw === null) return API_DEFAULT_PAGE_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n >= 1 && n <= API_MAX_PAGE_LIMIT ? n : null;
}

/** One page of `rows` (any order in): sorted by `idOf`, the rows after `after`, at most `limit`. */
export function pageOf<T>(rows: readonly T[], idOf: (row: T) => string, after: string | null, limit: number): { items: T[]; page: ApiPage } {
  const sorted = [...rows].sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
  const rest = after === null ? sorted : sorted.filter((r) => idOf(r) > after);
  const items = rest.slice(0, limit);
  const last = items[items.length - 1];
  return { items, page: { limit, next_cursor: rest.length > items.length && last !== undefined ? encodeCursor(idOf(last)) : null, total: rows.length } };
}
