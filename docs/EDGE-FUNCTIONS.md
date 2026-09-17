# Edge functions

Atlas's first Supabase Edge Function shipped with Sprint F7 item 1. This
document is the deploy/secret-setup checklist for it and for any function
that follows — see each function's own `index.ts` module comment for what
it actually does.

## `send-invite-email`

Sends the invite-notification email for an existing `invites` row, via
[Resend](https://resend.com). Holds no Supabase service-role key — it
forwards the calling owner's own session and relies on `invites_select`'s
RLS as its authorization check (see the function's own module comment,
`supabase/functions/send-invite-email/index.ts`).

### One-time setup

1. Create a Resend account and verify a sending domain (Resend's own
   dashboard walks through the DNS records). Without a verified domain,
   sends will fail or land in spam.
2. Create a Resend API key (Resend dashboard → API Keys).
3. Set the two secrets this function reads, against your Supabase project:

   ```sh
   supabase secrets set RESEND_API_KEY=re_your_key_here
   supabase secrets set RESEND_FROM_ADDRESS="Atlas <invites@yourdomain.com>"
   ```

   `RESEND_FROM_ADDRESS` must be an address on the domain you verified in
   step 1 — Resend refuses to send from an unverified domain.

4. Deploy the function:

   ```sh
   supabase functions deploy send-invite-email
   ```

`SUPABASE_URL`/`SUPABASE_ANON_KEY` are provided automatically to every edge
function by Supabase — nothing to set for those.

### Local development

`supabase start` (this repo's `pnpm db:start`) runs edge functions locally
too (`[edge_runtime]` is enabled in `supabase/config.toml`), but the two
Resend secrets above still need setting for a local run to actually send —
`supabase secrets set --env-file .env.local` (or export them before
`supabase functions serve`) with your own Resend test key.

### What this sprint could and couldn't verify

This function's logic (the RLS-scoped read, the Resend request shape, the
`last_sent_at` write-back) was written and reviewed against the real
migrated schema, and `pnpm lint`/`pnpm typecheck` cover it as far as a
Node-based toolchain can reach into a separate Deno runtime. Live email
delivery — an actual Resend account sending, an actual inbox receiving —
was **not** verified end-to-end in the sandbox this sprint was built in:
no Resend account or API key was available there. Confirm delivery once
for real, against your own Resend account, before relying on this in
production.

## `llm-proxy`

E4 (docs/prompts/atlas-prompt-pack.md), ADR-014: the shared LLM proxy —
provider auth, per-org rate limiting, and request logging without payload
retention, ported from the existing suite's own real, deployed `llm-proxy`
(see `docs/ADR-000-foundations.md`'s ADR-014 amendment for exactly what was
and wasn't carried over, and why this is a port into Atlas's own
deployment rather than Atlas calling the existing suite's project
directly). Anthropic only, no streaming — see the function's own module
comment (`supabase/functions/llm-proxy/index.ts`) for the full list of
deliberate cuts from the source it was ported from.

Holds the Supabase **service-role** key, unlike `send-invite-email` above —
it needs to write `llm_proxy_requests` (E4's own audit/rate-limit table;
nothing in this schema lets an ordinary member insert their own audit
rows) and to read `platform_config` (below). The real authorization check
is still the caller's own forwarded session: the request must name an
`orgId` the caller is actually a member of (`members_select`'s RLS),
exactly the same "re-derive server-side, never trust the client" pattern
every other edge function/RPC in this codebase already follows.

**Settings are application-level, not per-org** (E4 follow-up, resolved
with the human directly): model, rate-limit cap, and optionally the API
key itself are read from `platform_config`'s own `key = 'llm'` row first —
the same table/shape the existing suite's own `llm-proxy` already uses —
falling back field-by-field to the env-var secrets below when that row is
missing, or a given field on it is unset. There is no in-app settings
screen for this yet (Atlas has no platform-administrator role to gate one
with); changing a value today means writing the row directly.

### One-time setup

1. Create an Anthropic API key (console.anthropic.com).
2. Set the fallback secret this function reads when `platform_config` has
   no override:

   ```sh
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
   ```

3. Optional fallback secrets, both defaulted if unset (also overridable by
   `platform_config`, below):

   ```sh
   supabase secrets set LLM_PROXY_MODEL=claude-opus-5              # default shown
   supabase secrets set LLM_PROXY_RATE_LIMIT_PER_HOUR=100           # per-org cap, default shown
   ```

4. Deploy the function:

   ```sh
   supabase functions deploy llm-proxy
   ```

`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are provided
automatically to every edge function by Supabase — nothing to set for
those.

### Application-level overrides (`platform_config`)

`platform_config` has no client access at all — not even select, since a
row may hold a live secret (SPEC-data-model.md §9.5's own "service-role
only" template row). Set or change the `llm` row directly, e.g. via the
Supabase SQL editor or `psql`, as the service role:

```sql
insert into platform_config (key, value)
values ('llm', '{"model": "claude-opus-5", "rateLimitPerHour": 100}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Any of `model` (string), `rateLimitPerHour` (number), or `apiKey` (string —
overrides `ANTHROPIC_API_KEY` for every org) can be set; an absent field
falls back to its own env var. Deleting the row (or never creating it)
falls back to the env-var secrets above entirely — the function's original,
pre-follow-up behaviour.

### Calling it

```
POST /functions/v1/llm-proxy
Authorization: Bearer <the caller's own session JWT>
Content-Type: application/json

{
  "orgId": "…",
  "messages": [{ "role": "user", "content": "…" }],
  "maxTokens": 1024,
  "responseFormat": "text"
}
```

`src/contracts/llmProxy.ts`'s `buildLlmProxyRequest` builds this body's own
`messages`/`maxTokens`/`responseFormat` fields from loose input — a caller
still adds `orgId` itself, since the contract module has no notion of
"which organisation" (that's caller context, not part of the wire shape a
future capture pipeline and this file's own round-trip test both agree
on). Returns `{ status: 'ok', text, inputTokens, outputTokens }` on
success, or `{ status: 'error', message }` (400/401/403/429/500/503,
matching the failure) otherwise.

### Local development

Same as `send-invite-email` above — `pnpm db:start` runs this locally too;
set `ANTHROPIC_API_KEY` (and the two optional secrets, if you want
non-default values) via `supabase secrets set --env-file .env.local` or
before `supabase functions serve`.

### What this sprint could and couldn't verify

This function's logic (membership resolution, the per-org rate-limit
count against `llm_proxy_requests`, the `platform_config` read and its
field-by-field env-var fallback, the Anthropic request/response shapes,
the no-payload-retention log write) was written and reviewed against the
real migrated schema and the existing suite's own real, deployed
`llm-proxy` source. A live call — an actual Anthropic API key, an actual
response — was **not** verified end-to-end in the sandbox this sprint was
built in: no Anthropic API key was available there, and this sandbox has
no Docker route to a local Supabase to serve the function against in the
first place. Confirm a real call once, against your own Anthropic key,
before relying on this in production — and before F2 (capture) is built
to depend on it.
