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
                               # refuses to run unless SUPABASE_URL / VITE_SUPABASE_URL are localhost (src/db/assertLocalSupabase.ts); Playwright does the same
pnpm dev                     # the app, at http://localhost:5173
pnpm storybook               # every src/ui primitive in isolation, at http://localhost:6006
pnpm test:e2e                # Playwright, requires `pnpm db:start` and `pnpm build` (playwright.config.ts serves the built app)
pnpm check:case-collisions   # case-only path collisions (e.g. Foo.ts / foo.ts) — a local script, no git hook runs it for you
```

`pnpm db:reset` replays every migration in `supabase/migrations` against a fresh database.

Starter capability maps are content, not migrations, so a fresh local database has none — and several Playwright specs seed a model from one (the electricity map in particular). Before running `pnpm test:e2e` against a fresh stack, load and publish them: `pnpm content:load-capability-maps`, then `pnpm content:publish-capability-map <sector> <version>` for each sector's latest reviewed version (`electricity_network 4`, `hei 2`, `housing 2`, `local_government_england 2`, `local_government_scotland 2`, `nhs 2`, `public_body 2` as of October 2026 — `utility` has no reviewed version yet). The scripts read `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from the environment (`set -a; . ./.env; set +a`).

`pnpm build` / `pnpm build-storybook` — run them locally before pushing a UI change that touches build config or addon wiring, since typecheck/lint alone don't catch every build-time failure.

The browser only ever reads the `VITE_`-prefixed environment variables (`src/ui/env.ts`) — `SUPABASE_SERVICE_ROLE_KEY` has no `VITE_` counterpart and must never get one.

## What runs when

**Locally, before every push — nothing is enforced automatically, CLAUDE.md's Definition of Done requires it and the sprint summary reports it:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build` + `pnpm exec playwright test`, `pnpm check:case-collisions`. All of it, every time, on the commit actually being pushed.

**In GitHub Actions, on every push to `main` — and only that:** `.github/workflows/deploy-migrations.yml` runs `supabase db push` against the live "Architecture" project, then — only once that push succeeds — `curl`s `CLOUDFLARE_DEPLOY_HOOK` to deploy the app itself. No lint, no typecheck, no tests of any kind, no Docker, no Playwright, and nothing at all on a branch push or a pull request — CI's only job is getting an already-verified migration onto the live database and the app onto Cloudflare, in that order, not verifying anything itself. See CLAUDE.md's "Verification (all local)" section for why, and the note below for exactly what that one workflow does.

**In GitHub Actions, on every pull request and on demand — `.github/workflows/tests.yml`:** lint, typecheck, unit tests, case collisions, build, `pnpm test:integration` against a throwaway local Supabase, and the full Playwright suite (both projects, split into 8 shards, with one merged HTML report and failure traces uploaded as artifacts). It needs no secrets, so it is safe for fork PRs, and it runs on free standard runners only. Start it by hand from Actions → Tests → Run workflow. It does not replace the local list above for anyone who can run it locally; it is the way to run the Docker-backed suites when a machine can't. Two specs are left out of the Actions run and still run locally: the capture spec that needs a live language model (no API key there, by design), and the 300 ms route-timing budget spec (a speed budget means nothing on a shared runner). The other AI-related specs mock the model and do run.

**Cloudflare Workers Builds' own auto-build on push is turned off** (a Cloudflare-dashboard setting, not a file in this repository) — deliberately, as of Prompt 7g's A3 close-out. Before that, Workers Builds deployed the app itself on every push to `main`, racing the migration workflow above with no ordering guarantee between the two; now `deploy-migrations.yml` is the one place that sequences "migrations first, then the app," via the deploy-hook POST, so the app never starts serving a schema change before that schema change is live.

`pnpm release` (`supabase db push`, from the desktop) remains the local, manual fallback for the migrations half of the above — run it after `supabase link` (below) when pushing a migration ahead of, or instead of, waiting for the GitHub Actions workflow. It does not touch the app deploy; trigger `deploy-migrations.yml` by hand (`gh workflow run deploy-migrations.yml`, or the Actions tab's "Run workflow" button) if the app also needs deploying without waiting for the next push to `main`.

## Environments

The app itself is live at **https://atlas.simmodlr.app** — Cloudflare Pages/Workers, deployed by `.github/workflows/deploy-migrations.yml`'s own deploy-hook step (see "What runs when" above), pointed at the Supabase project below.

There is one live Supabase project this repository deploys to: **"Architecture"** (ref `<your-project-ref>`, `<your-region>`, org `<your-org-id>`) — the closest thing this product has to a "dev" environment today. There is no separate staging/production split yet; every migration in `supabase/migrations` is applied there. (A sibling project, "Des-studio", exists in the same organisation and belongs to the unrelated "existing suite" ADR-014/ADR-017 discuss — never target it. The "Architecture" project's own `public` schema was also found, during Sprint H1's environment work, to hold a handful of tables with no connection to Atlas or to that existing suite at all — `events`, `lap_data`, `strava_activities`, `training_metrics`, and a few `v_*` views — left over from unrelated use of the same project. They are not Atlas's; nothing here reads or writes them, and nothing in this repo should.)

To link a local checkout to it (needed for `supabase link`-dependent commands like `db push`/`db pull`/`migration repair`):

```sh
pnpm exec supabase login                              # once per machine; opens a browser
pnpm exec supabase link --project-ref <your-project-ref>
```

`supabase link` writes `supabase/.temp/project-ref` (gitignored — this is per-checkout state, never committed).

**How migrations — and the app — reach the live project:** `.github/workflows/deploy-migrations.yml` runs `supabase db push` automatically on every push to `main`, then POSTs the Cloudflare deploy hook — GitHub Actions' only job, per "What runs when" above; it trusts that verification already happened locally, the same way `git push` trusts a build already ran. It needs four repository secrets a human with access to both the Supabase project and the Cloudflare Pages/Workers project must set under Settings → Secrets and variables → Actions:

- `SUPABASE_ACCESS_TOKEN` — a personal access token from https://supabase.com/dashboard/account/tokens; authenticates `supabase link` and the management-API side of `db push`.
- `SUPABASE_PROJECT_ID` — the project ref (`<your-project-ref>` for "Architecture"); passed to `supabase link --project-ref`. Kept as a secret rather than a literal in the workflow so the same file could point at a different project without editing it, unlike the earlier version of this workflow which hardcoded the ref directly.
- `SUPABASE_DB_PASSWORD` — the project's own Postgres password (Settings → Database on the Supabase dashboard); the separate credential `db push` needs to open its own direct Postgres connection, distinct from the management-API token above.
- `CLOUDFLARE_DEPLOY_HOOK` — a deploy hook URL from the Cloudflare Pages/Workers project (Settings → Builds & deployments → Deploy hooks); POSTing it triggers a deploy without needing a Cloudflare API token in this repository. Create one and set it as this secret before relying on this workflow to deploy the app — see the note above about Workers Builds' own auto-build now being off.

This session had no way to add these itself; a human with dashboard access set them. Until they're set, the job fails fast on `supabase link` (or the deploy-hook step) rather than silently skipping. Before Sprint H1, no automated pipeline existed at all: every migration on the live project had been applied by hand, interactively, one at a time, and its recorded version numbers had drifted from the repo's own filenames (fixed once, Sprint H1, via `supabase_migrations.schema_migrations` — see `docs/AUDIT-2026-09-U2.md` §8 for the state this replaced; migration version drift recurred a second time on 10 September, this time from applying migrations via the Supabase MCP tool rather than the CLI — MCP-applied migrations are no longer used for that reason). To repair a similar drift by hand in future, compare `pnpm exec supabase migration list` (or the Supabase dashboard's Migrations page) against `supabase/migrations/` by name, and use `pnpm exec supabase migration repair --status applied <correct-version>` per mismatched entry.

Two edge functions are deployed to this project — `send-invite-email` (Sprint F7 item 1) and `llm-proxy` (E4) — see `docs/EDGE-FUNCTIONS.md` for deploy/secret-setup steps for each. `llm-proxy` is Atlas's own port of the existing suite's real `llm-proxy` function (ADR-014's own amendment in `docs/ADR-000-foundations.md` has the full reasoning); Atlas's code never calls the existing suite's own deployment on "Des-studio" directly, and never will.

## Layout

See CLAUDE.md's "Code layout" section for what belongs where.

## Licence

Atlas is free software, licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (`AGPL-3.0-or-later`). You may use, modify and sell it, including as a hosted service, provided you share your changes under the same licence. Section 13 of the AGPL means that if you run a modified version for other people over a network, you must offer those users the source of your version. Atlas links to its source from the sign-in page and the account menu (`src/ui/licence.ts`); a fork that changes the app should point that link at its own source.

The starter capability maps in `content/capability-maps/` state their own licence (CC BY 4.0) in each map's source description. Third-party dependencies keep their own licences (all permissive or weak-copyleft; see the pull request that introduced this section for the audit).
