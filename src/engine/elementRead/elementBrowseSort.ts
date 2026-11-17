/**
 * F1 ("custom attributes") PR4's pure sort logic, split out of
 * `useElementBrowse.ts` for the exact reason `roleGates.ts` was split out
 * of `useMembership.ts` (see that file's own module comment): a plain
 * `vitest run` unit test can't import anything from `useElementBrowse.ts`
 * directly, because that module pulls in `../supabaseClient.ts` at import
 * time, which throws without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
 * set. Re-exported from `useElementBrowse.ts`, so every existing import
 * site is unaffected — this is a location split, not a public API change.
 */
import type { Json } from '../../contracts/rows';

/** `{ custom: key }` sorts by an org-defined attribute's own raw value instead of one of the four fixed columns — one generic variant, not a fixed literal per attribute (F1's own decision 6). */
export type ElementBrowseSortKey = 'name' | 'type' | 'owner' | 'lifecycle' | 'criticality' | 'disposition' | 'aiAutonomy' | 'completeness' | { custom: string };

export function sortKeyEquals(a: ElementBrowseSortKey, b: ElementBrowseSortKey): boolean {
  if (typeof a === 'object' || typeof b === 'object') return typeof a === 'object' && typeof b === 'object' && a.custom === b.custom;
  return a === b;
}

/** A generic ordering for any custom attribute's raw `Json` value — numeric compare for two numbers, false-before-true for two booleans, `localeCompare` otherwise (a plain string compare already orders an ISO date string correctly). A missing value sorts as the empty string, matching `useElementBrowse.ts`'s own `owner`/`lifecycle` sort keys' `?? ''` convention. */
export function compareCustomAttributeValues(a: Json | undefined, b: Json | undefined): number {
  const av = a ?? null;
  const bv = b ?? null;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'boolean' && typeof bv === 'boolean') return Number(av) - Number(bv);
  const as = typeof av === 'string' ? av : av === null ? '' : JSON.stringify(av);
  const bs = typeof bv === 'string' ? bv : bv === null ? '' : JSON.stringify(bv);
  return as.localeCompare(bs);
}
