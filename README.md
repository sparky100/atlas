# Atlas

An enterprise-architecture product for mid-market and public-sector organisations, built model-first with diagrams as derived views. See `docs/ADR-000-foundations.md` for the why, `docs/SPEC-data-model.md` for the how, `docs/UI-principles.md` for the interface, and `CLAUDE.md` for how work happens in this repository — read that one first.

## Stack

Vite + React + TypeScript, Supabase (Postgres, auth, realtime, edge functions), Vitest, Playwright, pnpm.

## Setup

```sh
pnpm install
cp .env.example .env        # fill in SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY after db:start
pnpm db:start                # requires Docker; prints local keys — see `pnpm db:status`
pnpm lint
pnpm typecheck
pnpm test                    # unit and property tests, no database required
pnpm test:integration        # requires `pnpm db:start` first
```

`pnpm db:reset` replays every migration in `supabase/migrations` against a fresh database — the same check CI runs on every push.

## Layout

See CLAUDE.md's "Code layout" section for what belongs where.
