/**
 * Pure home-search type lists and matching logic, kept free of any
 * `supabaseClient` import (unlike `useHomeSearch.ts` itself) so it stays
 * unit-testable the same way `elementSearch.ts`'s own pure functions are —
 * a test importing `useHomeSearch.ts` directly would pull in a live
 * Supabase client construction at module scope, which throws outside an
 * environment with real Supabase env vars configured.
 */
import type { ElementType } from '../../contracts/delta';
import { hasExactMatch, type SearchPoolElement } from '../../db/elementSearch';

/** Top-level-only element types (ADR-001: `parentId` required non-null for container/component) — the only kinds a home-page search-and-create, with nowhere to pick a parent, can sensibly *create*. Search is broader — see `HOME_SEARCH_TYPES` below — this list governs the create dropdown only. */
export const HOME_SEARCH_CREATABLE_TYPES: readonly ElementType[] = ['capability', 'system', 'actor'];

/**
 * Every type Home search looks through — `HOME_SEARCH_CREATABLE_TYPES` plus
 * `container`. A container has no parent picker to create through from
 * Home (same reasoning that list's own doc comment gives), but it's a real
 * destination now — its own element page, and its own Context page (V3) —
 * so a search that never finds "SAP FI" at all is a real gap, and finding
 * an existing module by name is exactly this control's own duplicate-
 * prevention purpose (`elementSearch.ts`'s module comment).
 */
export const HOME_SEARCH_TYPES: readonly ElementType[] = [...HOME_SEARCH_CREATABLE_TYPES, 'container'];

/**
 * `hasExactMatch` (`elementSearch.ts`) restricted to `HOME_SEARCH_CREATABLE_TYPES`
 * — an exact match on a container's own name must not suppress the "Create
 * <type>" row, since a container was never one of the types that row
 * offers to begin with (a module and a top-level system/capability can
 * legitimately share a name — "Reporting" the module, "Reporting" the
 * system).
 */
export function hasCreatableExactMatch(pool: readonly SearchPoolElement[], query: string): boolean {
  return hasExactMatch(
    pool.filter((entry) => HOME_SEARCH_CREATABLE_TYPES.includes(entry.element.element_type)),
    query,
  );
}
