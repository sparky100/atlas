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

/**
 * Top-level element types (ADR-001: `parentId` null) — created immediately,
 * with no further step once a write branch is resolved (`container` below
 * is the one creatable type that isn't top-level, and needs its own "which
 * platform is this a module of?" step first — `HomeSearch.tsx`'s own
 * `showPlatformPicker`). Kept separate from `HOME_SEARCH_TYPES` below
 * because `hasCreatableExactMatch` still only ever needs this narrower,
 * unscoped-by-parent set — see that function's own doc comment.
 */
export const HOME_SEARCH_CREATABLE_TYPES: readonly ElementType[] = ['capability', 'system', 'actor'];

/**
 * Every type Home search's own create dropdown offers, and every type its
 * search looks through: `HOME_SEARCH_CREATABLE_TYPES` plus `container`.
 * "SAP FI" — an existing module, found by name — and "a new module of
 * SAP" — created by name plus a platform picker (`HomeSearch.tsx`'s own
 * `showPlatformPicker` sheet) — are both real, common things to want from
 * this one search box; a search that could never even find the module by
 * name was the real gap this list originally closed, and now the same
 * search box can create one too.
 */
export const HOME_SEARCH_TYPES: readonly ElementType[] = [...HOME_SEARCH_CREATABLE_TYPES, 'container'];

/**
 * `hasExactMatch` (`elementSearch.ts`) restricted to `HOME_SEARCH_CREATABLE_TYPES`
 * — an exact match on a container's own name must never suppress the
 * "Create <type>" row. Two independent reasons, not just one: a module and
 * a top-level system/capability can legitimately share a name ("Reporting"
 * the module, "Reporting" the system) *and*, even restricted to container
 * vs. container, this check has no platform to scope by — an existing "RE"
 * module of SAP must not block creating a different, unrelated "RE" module
 * of some other platform. The search results list above this row already
 * surfaces any real duplicate by name (containers are searched, just not
 * exact-match-suppressed) — that's the actual duplicate-catching moment,
 * not this blunt, parent-blind check.
 */
export function hasCreatableExactMatch(pool: readonly SearchPoolElement[], query: string): boolean {
  return hasExactMatch(
    pool.filter((entry) => HOME_SEARCH_CREATABLE_TYPES.includes(entry.element.element_type)),
    query,
  );
}

export interface SameNameModule {
  element: SearchPoolElement['element'];
  /** The platform (system) this is a module of, when it is in the pool — for `moduleDisplayName`. */
  parent: SearchPoolElement['element'] | null;
}

/**
 * Modules (containers) whose name or alias equals `query`, case-insensitively.
 * They never suppress "Create" (a short module name like "FI" is legitimately
 * reused across platforms — see `hasCreatableExactMatch`), so Add application
 * names them separately and links to each, so nobody creates an application
 * that is really an existing module without having been told.
 */
export function sameNameModules(pool: readonly SearchPoolElement[], query: string): SameNameModule[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const byId = new Map(pool.map(({ element }) => [element.element_id, element]));
  return pool
    .filter(({ element, aliases }) => element.element_type === 'container' && (element.name.toLowerCase() === q || aliases.some((a) => a.toLowerCase() === q)))
    .map(({ element }) => ({ element, parent: element.parent_id !== null ? (byId.get(element.parent_id) ?? null) : null }));
}
