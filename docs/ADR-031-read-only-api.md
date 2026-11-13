# ADR-031: A read-only HTTP API

**Status:** Proposed 2026-11-12; recommended option approved by Simon the same day ("Ok"). Moves to Accepted when the first PR merges.
**Depends on:** ADR-009 (tenancy, RLS), ADR-017 (organisations), ADR-028 (the read-only tools layer reused here), rules 4, 5 and 8 of `CLAUDE.md`.

## Context

Buyers comparing Atlas with Ardoq, LeanIX and Bizzdesign expect an API, and a read-only one is the safe base for reporting tools and, later, connectors. The model is already readable through the tools layer (`src/tools`); what is missing is a way for something that is not a signed-in person to call it.

## Decision

1. **Per-organisation API keys, created by owners in Organisation settings** ("API access"). A key is `atl_` plus 64 hex characters. Only its SHA-256 is stored (`api_keys.key_hash`, not selectable by any client role) with a 12-character visible prefix. The full key is returned once, by `atlas.create_api_key`. `atlas.revoke_api_key` sets `revoked_at`; the row stays. At most 20 active keys per organisation.
2. **A key reads only its own organisation**, only each model's live main line, and only through GET. There are no write endpoints and no path to the importer.
3. **Where it runs: a new edge function `api`** (`supabase/functions/api`), a thin shim over `src/api/handler.ts`, deployed with `--no-verify-jwt` because the bearer is an API key, not a JWT.
4. **No signed-in user means no row-level security to lean on, so the function holds the service-role key** (as `llm-proxy` does) and scopes in code: the key is checked and counted by `atlas.api_key_authorize` (service role only), models are looked up only among that organisation's own non-archived models (another organisation's id is "not found"), and every read is one model at its main head commit through the same readers Ask Atlas uses. The cross-organisation behaviour is tested (`src/api/handler.test.ts`, `src/db/apiKeys.integration.test.ts`). The alternative considered was SQL functions that verify the key with no service key; it would have left findings out of v1 and duplicated read logic in SQL.
5. **Versioning:** the version is in the path (`/v1`). Within v1 fields may be added, never renamed, removed or re-typed. Every response carries `meta.api_version`, and, for model data, the model and the commit it read.
6. **Pagination:** list endpoints take `limit` (1 to 200, default 50) and an opaque `cursor`, ordered by id, and report `page.total`.
7. **Rate limit:** 120 requests per key per minute, a fixed one-minute window counted in `api_key_usage` by `atlas.api_key_authorize`. Over it: `429` with `Retry-After`.
8. **Reads stay bounded** (rule 8): no `.in()` over a list that grows with the model; the model scope is read once and filtered in memory, as the pages and tools do.

## Out of scope

Write endpoints; reading a change's work in progress; comments, capture drafts and decisions; webhooks; per-key scopes or read-only-per-model keys; key expiry; SSO. The API does not honour `ai_assistant_enabled`: that switch governs sending content to Atlas's AI provider, whereas a key is a deliberate grant by an owner to a tool of their choosing.

## Consequences

- One migration (`20261112030000_api_keys.sql`), one contract file (`src/contracts/api.ts`), one edge function, one new folder `src/api/`.
- A service-role key is now in a second public-facing function. Revoking a key takes effect on the next request.
- Simon must apply the migration and deploy the function (`docs/API.md`).
