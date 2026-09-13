# CHECK-console.md — route-by-route console pass (S1 item 15)

First doc of its kind in this repo — referenced by name from several source
files (`docs/AUDIT-2026-09-12.md:137`) since the archived "A2" item, but
never actually written until now. No established `CHECK-*.md` format to
mirror, so the shape below (route, method, findings, fixed-in-this-pass or
not) is this pass's own judgment call — the intent is a durable record of
what was checked and when, not a one-off log to delete afterwards.

## Method

- Real local Supabase (`pnpm db:start`), real dev server (`vite`), driven
  through a browser (not mocked, not a unit test).
- A disposable, one-off fixture — one org, one model, one full set of
  element types (capability, two systems, a container, an actor), one edge
  of each of the three non-structural relationship types
  (`supports`/`uses`/`owns`), a tag, and a change branch with one edit — so
  that every route below renders real content rather than only an empty
  state. Built by a throwaway script, run once, deleted immediately after;
  never committed (CLAUDE.md rule 7 — no fixture reachable from a
  production code path, and no reason to keep a one-off seeding script
  around once its job is done).
- Signed in as that fixture's own owner/architect user. Checked
  `read_console_messages` and `read_network_requests` after each
  navigation.
- Every one of the 17 real routes in `src/ui/App.tsx` (excluding
  `/sign-in` and the `*` catch-all) was visited at least once. One route —
  `/o/:orgSlug/m/:modelSlug/review/:mergeRequestId` — has no reachable real
  merge request in this fixture (nothing was ever submitted for review) and
  so was not exercised with real content; its review-queue parent route
  (`/review`) was confirmed clean in its real empty state instead.

## Findings

### Fixed in this pass: a stale/empty `modelId` race left a false-positive error banner on 5 routes

**What was happening.** Several page-scoped data hooks are called with
`model?.id ?? ''` (or `?? null`) from their route component, before that
component's own `useOrganisationBySlug`/`useModels` resolves — this is an
established, harmless pattern everywhere else in this codebase, because the
hook re-runs the instant a non-empty id arrives and every one of them
already special-cases the loading state.

Five hooks, though, only guarded their effect on `userId` (or nothing at
all), not on `modelId`/the relevant element id — so the effect's *first*
run, before the real id exists, called `resolveRef(supabase, '', ref)` (or
equivalent), which throws by design (`resolveRef`'s own "called with an
empty/undefined `model_id`... a gate missing further up, not a real query
to run" guard). Previously this was invisible: the `catch` only set local
component state, which the very next successful run overwrote before a
render with the error state ever painted. This item's own Part 2 (wiring
`reportError` into every data-loading hook, S1 item 15's other half) is
what turned that invisible race into a real, user-facing problem — the
global error banner (`errorBannerStore`) has no lifetime tied to the
component that raised it, so the false-positive "Couldn't load..." banner
now stayed up at the top of the page even after the content loaded
successfully underneath it, needing a manual "Dismiss".

This exact shape had already been fixed once before, in
`useBreadcrumbElement.ts` (Sprint U4-2a item 2's own doc comment there
describes the identical bug, caught the same way — a console-open route
pass). That fix (guard the effect on `modelId` as well as the id it
resolves against, so the effect simply doesn't fire until both are real)
is applied here to the remaining five call sites that were missing it,
found by grepping every hook that calls `resolveRef(supabase, modelId,
...)` for the same gap:

| Hook | Route(s) affected | Guard added |
|---|---|---|
| `src/ui/elements/useElementPage.ts` | `/e/:elementId` | `if (!modelId \|\| !elementId) return undefined;` |
| `src/ui/capabilityMap/useCapabilityMap.ts` | `/capability-map` | added `\|\| !modelId` alongside the existing `!userId` check |
| `src/ui/structureView/useStructureView.ts` | `/container/:systemId` | added `\|\| !modelId \|\| !parentId` alongside the existing `!userId` check |
| `src/ui/context/useSystemContext.ts` | `/context/:systemId` | added `\|\| !modelId \|\| !systemId` alongside the existing `!userId` check |
| `src/ui/versions/useVersionDiff.ts` | `/diff` | `if (!modelId) return undefined;` (had no guard of any kind before) |

Verified by reproducing each false-positive banner on this branch before
the fix (`/e/:id`, `/context/:id`, `/diff` all reproduced live; `/container/
:id` and `/capability-map` share the identical unguarded-effect shape and
were fixed the same way on inspection, matching the pattern exactly), then
confirming a clean reload shows no banner and no console error on all five.

### Everything else: clean

No other route produced a console error or an unexpected failed network
request across this pass. Routes visited with real fixture content and no
findings: `/`, `/o/:orgSlug`, `/o/:orgSlug/settings`, `/o/:orgSlug/m/
:modelSlug` (both Director and Architect doors), `/o/:orgSlug/m/:modelSlug/
settings`, `/o/:orgSlug/m/:modelSlug/elements`, `/landscape`, `/versions`,
`/changes`, `/changes/:branchId`, `/review`, `/boundary-crossings`,
`/external-interfaces`.

### Not a per-route finding: a stray 400 during sign-in

A single `Failed to load resource: 400 (Bad Request)` appeared once, only
during the very first sign-in of this pass's freshly-created fixture user,
and did not reappear on any subsequent navigation. It scrolled out of the
browser's own network-request buffer before it could be attributed to a
specific request, and every request captured around that window (password
grant, `consume_my_invites`, `user_preferences`, `notifications`,
`profiles`) came back 200/204/204. The most likely explanation is a
Supabase auth client's own silent session-refresh attempt on a tab with no
existing session yet — ordinary, expected behaviour for a brand-new
tab/account — not something this pass's fixture (created via a raw
`auth.signUp()` API call rather than the app's own sign-up form) should be
assumed to have caused, but also not confirmed harmless with certainty.
Recorded here rather than chased further, since it did not recur on any of
the 17 routes actually in scope for this item.

## Verification

- `pnpm typecheck` — clean, after the five hook guards above.
- Manual reload of each affected route in a real browser against real
  local Supabase, before and after the fix, confirming the banner/console
  error is gone and the page's real content still renders.
