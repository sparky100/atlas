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
directly). Anthropic only. No streaming to the caller for capture's own
calls — see the function's own module comment
(`supabase/functions/llm-proxy/index.ts`) for the full list of deliberate
cuts from the source it was ported from. The in-app help chat (`src/ui/
help/`) is the one caller that does stream to the browser, via the
additive `streamToClient` field below, ported back from that same source
now that an interactive chat UI actually exists in Atlas.

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
missing, or a given field on it is unset.

**There is now an in-app settings page — `/platform-admin`** — gated on
Atlas's first cross-org role, a platform administrator (`docs/PLATFORM-ADMIN.md`
has the full design and the one-off SQL that grants the first one; there is
still no self-serve way to *become* one). A platform admin can change
model/rate-limit/API key from that page without ever touching Supabase
secrets, SQL, or a redeploy — only granting the role itself still needs SQL.

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

**The `/platform-admin` page (docs/PLATFORM-ADMIN.md) is the normal way to
change these now** — a platform admin edits model/rate-limit/API key
directly in the app. What follows is the underlying mechanism, and the
path this repo used before that page existed (still valid — a
`security definer` RPC read/writes this table too, but going straight at
it with SQL works exactly as well for a one-off change).

`platform_config` has no client access at all — not even select, since a
row may hold a live secret (SPEC-data-model.md §9.5's own "service-role
only" template row). Set or change the `llm` row directly, e.g. via the
Supabase SQL editor or `psql`, as the service role:

```sql
insert into platform_config (key, value)
values ('llm', '{"provider": "anthropic", "model": "claude-opus-5", "rateLimitPerHour": 100}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
```

Any of `provider` (string), `model` (string), `rateLimitPerHour` (number),
or `apiKey` (string — overrides `ANTHROPIC_API_KEY` for every org) can be
set; an absent field falls back to its own env var. Deleting the row (or
never creating it) falls back to the env-var secrets above entirely — the
function's original, pre-follow-up behaviour.

`provider` is stored, and settable via `/platform-admin`'s own picker, even
though this function's own routing (`callAnthropic`, above) only ever calls
Anthropic — `atlas.set_platform_llm_config` (below) rejects anything but
`'anthropic'`. The field exists so a second provider's config surface, if
one is ever built, is an addition to an existing shape rather than a
migration to introduce one — see `docs/ADR-000-foundations.md`'s ADR-014
amendment and `20260921020000_platform_llm_provider.sql`'s own module
comment for the reasoning.

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

**F2 (full K1) additions, SPEC-capture.md §3.5/§6 (K-10).** Three optional
request fields and two optional response fields, added without touching
the shape above (`LLM_PROXY_CONTRACT_VERSION` bumped so a log row or
cassette can tell which shape produced it):

- `outputConfig?: { effort: 'low'|'medium'|'high'|'xhigh'|'max', format: { type: 'json_schema', schema } }` — asks the provider for schema-constrained JSON via its own `output_config`, instead of `responseFormat: 'json'`'s free-form hint.
- `cacheControl?: boolean` — marks the joined system-role content as a stable, cache-controlled prefix (`cache_control: { type: 'ephemeral' }`).
- `stream?: boolean` — asks the proxy to stream the generation from the provider internally, so a long prose-extraction call doesn't sit on one buffered upstream response long enough to time out. This call's own response to its caller is never `text/event-stream` on its own — always one complete JSON body, unless `streamToClient` (below) is also set.
- `streamToClient?: boolean` — the help chat's own opt-in: forwards the provider's raw SSE straight through as this call's own `text/event-stream` response, instead of buffering it into JSON. Requires `stream: true`, `responseFormat: 'text'`, and no `outputConfig`. One `llm_proxy_requests` row is still logged once the stream ends (usage is parsed from the forwarded bytes as they pass through, not from a second call).
- Response gains `stopReason?: string` (the provider's own stop reason — `end_turn`/`max_tokens`/`refusal`/…) and `cacheReadTokens?: number`.

`src/capture/llm/client.ts`'s `ProxyLlmClient` is the one caller that sets
all three request fields; every other caller (`send-invite-email`
included) omits them and gets exactly the response it always did.

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

## `capture-run`

F2 (full K1) PR12, SPEC-capture.md §3.5: runs the capture pipeline for one
`capture_jobs` row — parse → extract → match → write. Invoked with
`{jobId}` by the client (user JWT). Holds the service role, like
`llm-proxy` above, for the same reason: writing `capture_candidates` and
calling `atlas.write_capture_draft` needs it (see that RPC's own migration
comment, `20260920030000_write_capture_draft.sql`). The real authorization
check is still the caller's own forwarded session — `capture_jobs_select`'s
RLS (contributor+ of the job's own org) is read with the caller's JWT
*first*; only a row that comes back at all switches to service role for
everything after (`supabase/functions/capture-run/index.ts`'s own module
comment).

Almost none of this function's own logic lives in `supabase/functions/capture-run/`
itself — the step machine is `src/capture/captureRunStep.ts` (Vitest-tested
against a fake dependency layer, no Deno runtime needed for that), and
`supabase/functions/capture-run/_source/db.ts` is a thin adapter wiring that
step's injected dependencies to real Postgres/Storage/`llm-proxy` calls.
`_source/index.ts` itself is only auth + wiring, exactly like `llm-proxy`'s
own split of "real logic vs. transport shim."

**The deployed `index.ts` is generated, not hand-authored.** A real deploy
attempt confirmed the risk this section used to only disclose: Deno's edge
runtime does not honour the `sloppy-imports` unstable flag during
`supabase functions deploy`'s own graph-resolution step, so this function's
extension-less relative imports into `src/capture`, `src/engine`, and
`src/contracts` failed with `failed to create the graph … Module not
found`, even with `deno.json`'s `"unstable": ["sloppy-imports"]` set — a
known Supabase Edge Runtime limitation
([supabase/cli#3426](https://github.com/supabase/cli/issues/3426),
[supabase/edge-runtime#410](https://github.com/supabase/edge-runtime/issues/410)),
not a bug specific to this function. The hand-authored source now lives at
`supabase/functions/capture-run/_source/` (`index.ts`, `db.ts`); edit those.
`scripts/bundleCaptureRunFunction.ts` uses esbuild to bundle `_source/index.ts`
and everything it imports from `src/` into one flat, dependency-free
`supabase/functions/capture-run/index.ts` — the file Deno actually loads —
leaving only the npm packages `deno.json`'s `imports` map already resolves
(plus the one `esm.sh` URL import) external. That generated file is
gitignored; **run `pnpm functions:bundle:capture-run` (or the composite
`pnpm functions:deploy:capture-run`, which bundles then deploys) before
every deploy** — a stale or missing bundle means the deploy either fails
the same way or ships whatever was bundled last, not what's in `_source/`.

**K-12's resumability, narrowed.** SPEC's K-12 asks for a step-driven
function doing bounded (≤ 60 s) work per invocation, with
`capture_jobs.progress` advancing per chunk so a crash resumes from the
last completed one. `runCapture()` (PR10/PR11) isn't internally chunked
that way, and there's nowhere in today's schema to stash a partial
candidate set between two invocations. Agreed with the human on this PR's
own planning turn: this function instead does **job-level retry only** —
one invocation runs the whole pipeline or fails outright, and nothing is
written to `branches`/`commits`/`deltas`/`capture_candidates` until the one
atomic `write_capture_draft` call at the end, so a crash loses no data; a
retry (calling this function again with the same `jobId`) simply reruns
everything. `progress` still names the coarse phase running (`extract` or
`write`) but never advances `done`/`total`, and `{status: 'continue'}` is
never returned. See `captureRunStep.ts`'s own module comment for the full
reasoning. The function is genuinely idempotent, though: calling it again
on an already-`parsed`/`reviewed`/`discarded` job is a safe no-op.

### One-time setup

No new secrets beyond what `llm-proxy` already needs — this function calls
that one internally (`ProxyLlmClient`, forwarding the caller's own session
JWT as the bearer token) rather than holding its own Anthropic key. Set
`CAPTURE_RUN_LLM_DIRECT=true` (plus `ANTHROPIC_API_KEY` on *this* function)
only if no `llm-proxy` is deployed yet and you want `capture-run` to call
Anthropic directly (`DirectLlmClient`) instead.

```sh
pnpm functions:deploy:capture-run
```

(equivalent to `pnpm functions:bundle:capture-run && supabase functions deploy capture-run`
— see above for why the bundle step is required, not optional).

`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are provided
automatically, as with every edge function above.

### Calling it

```
POST /functions/v1/capture-run
Authorization: Bearer <the caller's own session JWT>
Content-Type: application/json

{ "jobId": "…" }
```

Returns the step's own result verbatim (200 for `{status:'parsed'|'noop'}`,
422 for `{status:'failed', error:{code,message}}` — one of §11's failure
codes, e.g. `NO_USABLE_SHEET`, `INPUT_ENCRYPTED`, `LLM_REFUSAL`, or the
disclosed catch-all `CAPTURE_RUN_FAILED` for anything else), 401/404/405/500
for a request-level problem (missing auth, unknown/unauthorized job, wrong
method, missing env config).

### What this sprint could and couldn't verify

`src/capture/captureRunStep.ts` (the step machine itself — idempotency,
retry-after-failure, the §11 error-code classification, the whole
parse→extract→match→write sequence against a fake dependency layer) is
real, Vitest-covered code, run for real in this sandbox.
`supabase/functions/capture-run/_source/db.ts`/`index.ts` were **not** —
same standing gap as `llm-proxy`/`send-invite-email` (no Docker route to a
local Supabase here). One of the two PR12-specific risks this section used
to flag has since been hit for real and fixed (the extension-less-import
resolution failure — see above); the other is still open:

- `capture_jobs.input_ref`'s own stored shape
  (`capture-inputs/{org}/{model}/{job}/{filename}`, per
  `writeCaptureDraft.integration.test.ts`'s own fixture value) includes the
  bucket name as a path segment, which `storage.objects` itself never
  stores; `db.ts`'s `downloadInput` strips that prefix before calling
  `.storage.from('capture-inputs').download(...)`. Confirmed against the
  existing test's own literal string, not against a real upload.

Confirm that one against a real capture run in production, alongside
`llm-proxy`'s own not-yet-confirmed live call. `scripts/bundleCaptureRunFunction.ts`
itself has been run for real and produces a clean bundle (no unresolved
specifiers); the deploy this section's bundling fix targets has not yet
been re-attempted end to end after the fix — do that once before relying on
this in production.
