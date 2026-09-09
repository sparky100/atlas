# Atlas

An enterprise-architecture product for mid-market and public-sector organisations, built model-first with diagrams as derived views. See `docs/ADR-000-foundations.md` for the why, `docs/SPEC-data-model.md` for the how, `docs/UI-principles.md` for the interface, and `CLAUDE.md` for how work happens in this repository — read that one first.

## Stack

Vite + React + TypeScript, Supabase (Postgres, auth, realtime, edge functions), Vitest, Playwright, pnpm.

## Setup

```sh
pnpm install
cp .env.example .env        # fill in SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY *and* the VITE_ pair after db:start
pnpm db:start                # requires Docker; prints local keys — see `pnpm db:status`
pnpm lint
pnpm typecheck
pnpm test                    # unit and property tests, no database required
pnpm test:integration        # requires `pnpm db:start` first
pnpm dev                     # the app, at http://localhost:5173
pnpm storybook               # every src/ui primitive in isolation, at http://localhost:6006
pnpm test:e2e                # Playwright, requires `pnpm db:start` and `pnpm build` (playwright.config.ts serves the built app)
pnpm check:case-collisions   # case-only path collisions (e.g. Foo.ts / foo.ts) — a local script, no git hook runs it for you
```

`pnpm db:reset` replays every migration in `supabase/migrations` against a fresh database.

`pnpm build` / `pnpm build-storybook` — run them locally before pushing a UI change that touches build config or addon wiring, since typecheck/lint alone don't catch every build-time failure.

The browser only ever reads the `VITE_`-prefixed environment variables (`src/ui/env.ts`) — `SUPABASE_SERVICE_ROLE_KEY` has no `VITE_` counterpart and must never get one.

## What runs when

**Locally, before every push — nothing is enforced automatically, CLAUDE.md's Definition of Done requires it and the sprint summary reports it:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` + `pnpm exec playwright test`, `pnpm check:case-collisions`. All of it, every time, on the commit actually being pushed.

**In GitHub Actions, on every push to `main` — and only that:** `.github/workflows/deploy-migrations.yml` runs `supabase db push` against the live "Architecture" project. No lint, no typecheck, no tests of any kind, no Docker, no Playwright, and nothing at all on a branch push or a pull request — CI's only job is getting an already-verified migration onto the live database, not verifying anything itself. See CLAUDE.md's "Verification (all local)" section for why, and the note below for exactly what that one workflow does.

**On every push, outside GitHub Actions entirely:** Cloudflare Workers Builds deploys the app itself — no command in this repository triggers it and none needs to; it's configured on Cloudflare's side against this repository's `main` branch.

`pnpm release` (`supabase db push`, from the desktop) is the manual equivalent of the migrations half of the above — run it after `supabase link` (below) when pushing a migration ahead of, or instead of, waiting for the GitHub Actions workflow. It does not touch the app deploy: Cloudflare's own push-triggered build already covers that, which is all the script's own closing line says.

## Environments

There is one live Supabase project this repository deploys to: **"Architecture"** (ref `xakqcssapdiatwrmnjop`, `eu-central-1`, org `eyuhmtxtmcddtsptqvyv`) — the closest thing this product has to a "dev" environment today. There is no separate staging/production split yet; every migration in `supabase/migrations` is applied there. (A sibling project, "Des-studio", exists in the same organisation and belongs to the unrelated "existing suite" ADR-014/ADR-017 discuss — never target it. The "Architecture" project's own `public` schema was also found, during Sprint H1's environment work, to hold a handful of tables with no connection to Atlas or to that existing suite at all — `events`, `lap_data`, `strava_activities`, `training_metrics`, and a few `v_*` views — left over from unrelated use of the same project. They are not Atlas's; nothing here reads or writes them, and nothing in this repo should.)

To link a local checkout to it (needed for `supabase link`-dependent commands like `db push`/`db pull`/`migration repair`):

```sh
pnpm exec supabase login                              # once per machine; opens a browser
pnpm exec supabase link --project-ref xakqcssapdiatwrmnjop
```

`supabase link` writes `supabase/.temp/project-ref` (gitignored — this is per-checkout state, never committed).

**How migrations reach the live project:** `.github/workflows/deploy-migrations.yml` runs `supabase db push` automatically on every push to `main` — GitHub Actions' only job, per "What runs when" above; it trusts that verification already happened locally, the same way `git push` trusts a build already ran. It needs two repository secrets a human with access to the Supabase project must set under Settings → Secrets and variables → Actions — `SUPABASE_ACCESS_TOKEN` (from https://supabase.com/dashboard/account/tokens) and `SUPABASE_DB_PASSWORD` (the project's own Postgres password, Settings → Database on the Supabase dashboard) — this session had no way to add them itself. Until they're set, the job fails fast on `supabase link` rather than silently skipping. The project ref (`xakqcssapdiatwrmnjop`) is a literal in the workflow, not a secret — it's not sensitive, and it's already named here. Before Sprint H1, no such pipeline existed at all: every migration on the live project had been applied by hand, interactively, one at a time, and its recorded version numbers had drifted from the repo's own filenames (fixed once, Sprint H1, via `supabase_migrations.schema_migrations` — see `docs/AUDIT-2026-09-U2.md` §8 for the state this replaced). To repair a similar drift by hand in future, compare `pnpm exec supabase migration list` (or the Supabase dashboard's Migrations page) against `supabase/migrations/` by name, and use `pnpm exec supabase migration repair --status applied <correct-version>` per mismatched entry.

No edge function is deployed to this project — `supabase/functions/` doesn't exist in this repository. The `llm-proxy` function ADR-014 discusses is the existing suite's own, deployed to "Des-studio", not to Atlas's project, and Atlas's code never calls it.

## Layout

See CLAUDE.md's "Code layout" section for what belongs where.
