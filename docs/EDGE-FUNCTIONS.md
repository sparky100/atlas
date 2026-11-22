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

Any of `provider` (string), `model` (string) or `rateLimitPerHour` (number)
can be set; an absent field falls back to its own env var. The provider API
key is no longer kept on this row: it lives in Supabase Vault
(`platform:llm_api_key`, set from the platform admin page) and overrides
`ANTHROPIC_API_KEY` for every org. A legacy `apiKey` on the row is still read
until `20261114090000_security_hardening.sql` moves it into Vault. Deploy
`llm-proxy` before pushing that migration (`supabase functions deploy llm-proxy`). Deleting the row (or
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

**Tool support (F15, ADR-028 §3).** Contract version `2026-11-06` adds, all
optional: message `content` may be a list of `text` / `tool_use` /
`tool_result` blocks; `tools` (name, description, JSON Schema); `toolChoice`
(`'none'` forbids calling a tool, for the closing round); and the response
may carry `toolCalls`. A request without these behaves exactly as before.
`tools` cannot be combined with `outputConfig`, and a streamed passthrough
may carry tools only with `toolChoice: 'none'`. The shape is checked in both
`src/contracts/llmProxy.ts` and this function, by hand.

## `ask-model`

F15, ADR-028: answers one Ask Atlas question. Invoked with
`{modelId, question, history?}` by the signed-in user. **It never holds the
service-role key**: every read uses the caller's forwarded session, so
row-level security decides what is visible, and model calls go through
`llm-proxy` with that same token (provider auth, the hourly cap and cost
logging stay there). It checks, in order, that the model is readable by the
caller, that the model's owning organisation has `ai_assistant_enabled`
(off by default, owner-only), and that the main line has a commit; only then
is anything sent to the provider. It also reads the organisation's
`ai_share_run_cost` (off by default): unless it is on, run cost is removed
from every tool result. After this change `ask-model` must be redeployed
(`pnpm functions:deploy:ask-model`); until then it still sends the cost band.

The `api` function reads the same `ai_share_run_cost` flag for the key's organisation: unless it is on, run cost is removed from every API result. `api` must be redeployed for this to take effect.

The response is `application/x-ndjson`: `{"type":"event",...}` lines as
lookups start and finish, then one `{"type":"result",...}` (status `done`,
`not_found`, `disabled`, `empty_model` or `invalid`) or
`{"type":"error","code":"rate_limited"|"provider"|"failed",...}`. The final
written answer is returned whole in the result in this version; streaming the
answer text itself through the proxy passthrough is a later refinement.

Logic lives in `src/tools/askHandler.ts` and `askLoop.ts` (Vitest, no Deno);
`supabase/functions/ask-model/_source/index.ts` is only wiring. Bundled like
`capture-run`: **run `pnpm functions:bundle:ask-model` (or
`pnpm functions:deploy:ask-model`) before every deploy**; the generated
`index.ts` is git-ignored. Deploy it after `llm-proxy` (it needs the
tool-support version) and after the `20261107010000` migration.

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

**CI deploys it too (2026-10-08).** `.github/workflows/deploy-migrations.yml` bundles and deploys `capture-run` on every push to `main`, after the migrations and before the app. Before this, a merged importer change (`src/capture`) reached the app but not the function: the round-trip fix (#352) was live in the UI while imports still ran the old importer. `llm-proxy` and `send-invite-email` are still deployed by hand.

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

## `send-review-email`

Emails each reviewer who has just been assigned to a change (submit for
review, or an edit to the reviewer set), with a link to that review. The
in-app notification is unchanged and still the primary signal; this adds the
email. Triggered by the app (`src/db/reviewEmail.ts`, called from
`submitMergeRequest` and `setReviewers`), best-effort — a failed send never
fails the submit.

Holds the **service-role** key (a reviewer's address lives in `auth.users`,
not readable by members). It authorises by hand first: the caller must see
the merge request through RLS and be its requester or an owner/architect.
Recipients are never taken from the request: only people with an un-emailed
`review_assigned` notification who haven't switched off
`user_preferences.email_on_review_assigned` (Profile → Notifications).
`notifications.emailed_at` prevents double sends.

**Reminder mode.** The same function, called with `{ mergeRequestId, reminder: true }`
(`sendReviewReminder` in `src/db/reviewEmail.ts`, from the "Remind reviewers"
button on an overdue review), sends the one reminder for a review that is
still `pending` past the organisation's `review_period_days`. Recipients are
the reviewers whose verdict is still `pending` and who haven't switched off
`email_on_review_assigned`. Same authorisation (requester or owner/architect).
`merge_requests.reminded_at` is claimed with a conditional update before any
send, so a review is reminded at most once; the claim is released if nothing
went out. It is a button, not a schedule: nothing sends it automatically on
the due date (that would need a scheduler holding the service key — not built).

**Stale-data mode.** The same function, called with `{ staleNudge: true, modelId }`
(`sendStaleNudges` in `src/db/staleNudge.ts`, from **Email owners a reminder**
above the out-of-date list on the Elements page), emails each person the
elements that have gone stale. The caller must be an owner or architect of the
model's organisation (checked by hand before any service-role read). Who gets
what comes from `atlas.stale_nudge_recipients` (service role only): the member
behind a business or technical owner of the element, else the organisation's
architects (owners if there is no architect). Skipped: anyone emailed for this
model in the last 7 days, anyone with `email_on_stale_nudge` off, anyone with
no email address. A `stale_nudges (model_id, user_id, sent_on)` row is inserted
before each send (the unique key stops two simultaneous presses double-sending)
and deleted again if the send fails. Opening an email link only opens the
element page; nothing is marked accurate. Button-driven, not scheduled.

Secrets: `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (shared with
`send-invite-email`) and **`ATLAS_APP_URL`** (new; the app's public base URL,
no trailing slash, e.g. `https://atlas.simmodlr.app`). Deploy with
`supabase functions deploy send-review-email`. Live delivery was not
verified in the build sandbox (no Resend key): confirm once for real.

## `api`

The read-only API (ADR-031, `docs/API.md`). Holds the service-role key (provided automatically) and scopes every read to the calling API key's organisation in code. Deploy with `pnpm functions:deploy:api`; it must be deployed with `--no-verify-jwt` (already in the script, and `[functions.api]` in `supabase/config.toml` for local runs), since callers send an API key rather than a Supabase JWT. Live behaviour (a real key against the deployed function) is not verifiable in the sandbox this was built in: after deploying, create a key in Organisation settings and `curl` `/v1/models` once.

## `connector-fetch`

Live connectors (ADR-032, `docs/import/mulesoft/connector.md`). Called with the signed-in user's own session (JWT verified by the platform): the connector row is read as that user, so owner/architect row-level security is the permission check, then the service role reads the one secret from Supabase Vault. Deploy with `pnpm functions:deploy:connector-fetch`, after the migration `20261113060000_org_connectors.sql` (which enables the Vault extension). Outbound HTTPS to `anypoint.mulesoft.com` (or the `eu1`/`gov` host) must be allowed. Live behaviour against a real Anypoint organisation has not been verified: after deploying, an owner sets up a connection in Organisation settings and presses **Test connection**.

## `org-ai-key`

Phase D step 1. Saves or removes an organisation's own AI key (for agents). POST `{ orgId, action: 'set' | 'clear', key? }` with the caller's session. The caller must be an owner of the organisation (checked through their own session); only then does the function use the service role to call `atlas.set_org_ai_key` / `atlas.clear_org_ai_key`, which keep the key in Vault. The key is never returned, logged or put in an error. Replies `saved`, `cleared`, `invalid` (400), `forbidden` (403) or a plain `error` (500). Deploy with `pnpm functions:deploy:org-ai-key` (default JWT verification stays on). Until it is deployed, the Agents section of organisation settings says it cannot reach the key service.


## `design-agent`

Phase D step 2. The Designer agent: POST `{ modelId, elementId, finding }` with the caller's session. Everything it decides is in `src/tools/designHandler.ts`. In order: the model must be readable by the caller (else `not_found`); the caller must be an owner or architect of its organisation (else `forbidden`); the organisation must have Ask Atlas on, agents on and an AI key saved (else `not_enabled`); the model must have a main commit (else `empty_model`). It then runs the Designer through the same lookup tools as Ask Atlas, with run cost withheld unless the owner shares it, and replies `{ status: 'done', result, stamp }`: a draft option set as plain text for a person to read and edit, with citations that a tool actually returned. It writes nothing. It calls the model through `llm-proxy` with `useOrgKey: true`, so it runs on the organisation's own key and never falls back to the platform key. Reads use the caller's own session (no service role). Deploy with `pnpm functions:deploy:design-agent` (default JWT verification stays on).

`llm-proxy` change for this step: a request may carry `useOrgKey: true`. The proxy then refuses with a 403 unless the caller is an owner or architect of the organisation and the organisation has Ask Atlas on, agents on and a saved key; it reads the key with `atlas.org_ai_api_key` (service role) and uses it instead of the platform key. Requests without `useOrgKey` behave exactly as before. `llm-proxy` must be redeployed for agents to work. Known limit: any owner or architect could send `useOrgKey` to the proxy directly with their own prompt, bounded by the same hourly rate limit and recorded in `llm_proxy_requests`; the cost record split by key source arrives in step 3.

`llm-proxy` change for Phase D step 3: every row in `llm_proxy_requests` now records `key_source`: `org` when the call used the organisation's own key (`useOrgKey`, agents), `app` for everything else (and for every older row). The Agents card in organisation settings reads it (counts and tokens this month, never content). `llm-proxy` must be redeployed (`supabase functions deploy llm-proxy --use-api`); until it is, new rows default to `app` and the Agents card shows zero.

`llm-proxy` change for the Designer free trial (Simon, 2026-11-20): with `useOrgKey: true` and NO saved key, the proxy no longer refuses outright. If the assistant and agents switches are on and the caller is an owner, architect or contributor, it may run the Designer on the platform key for a limited trial: `TRIAL_RUNS` (5) runs per organisation, counted by a `runId` the Designer sends (one run makes several model calls; a run counts once it has a successful call), plus a `TRIAL_TOKENS` (300,000) backstop. A run already started always finishes. A platform-wide daily cap (`LLM_TRIAL_DAILY_TOKENS`, default 2,000,000, function secret) stops new runs when reached, against organisations created only to farm trials. `LLM_TRIAL_ENABLED=false` (function secret) turns the trial off, for self-hosters. Every lookup that fails refuses; it never spends the platform key on an error. Rows record `key_source = 'trial'` and `run_id` (migration `20261120030000_designer_trial_allowance.sql`: one constraint widened, one nullable column, no new table, grant, policy or function). The numbers live in `supabase/functions/llm-proxy/index.ts` and `src/contracts/trialAllowance.ts`; keep them in step by hand. Known limit: two runs started at the same moment can both pass the check, so an organisation can exceed 5 by a run; the hourly rate limit and the daily cap bound it. `llm-proxy` and `design-agent` must both be redeployed (`--use-api`) after the migration is applied.

## `research-agent` (D4 guarded Researcher, backend step)

POST `{ decisionId, branchId, query }` under the caller's session. This is the only caller allowed to ask `llm-proxy` for a web search. The query is the person's own approved text; nothing from the estate model is added. In order: the decision must be readable (else `not_found`); the caller must be an owner, architect or contributor (else `forbidden`); the organisation must have web research switched on (`organisations.ai_web_search_enabled`, default off), Ask Atlas on, agents on and its own AI key saved (else `not_enabled`); the decision must still be `proposed` and the option must be a `branch` link (else `forbidden`). It then sends the exact query, through `llm-proxy`, with `useOrgKey: true`, `requireOrgKey: true` and `webSearch: { maxUses: 1 }`, and with the server-only `x-atlas-research-secret` header. The proxy refuses a `webSearch` without that secret, so no browser or ordinary caller can start one. The function writes one append-only `web_research_requests` row (query, person, organisation, decision/option, result count and URLs) before returning candidates. It reads with the caller's RLS session and never reads the service-role key. It has no estate tools: the only input is the approved query. Deploy with `pnpm functions:deploy:research-agent` after `llm-proxy` and after applying `20261122080000_web_research_guarded.sql`; set the same `ATLAS_RESEARCH_SECRET` as a function secret on both `llm-proxy` and `research-agent`. The UI that approves the query, checks the excerpt and saves the page is a later step.

## `review-agent` (D2 reviewers, backend step)

POST `{ decisionId, lens: 'challenge' | 'cyber' | 'data' }` under the caller's session. This backend has no user-facing entry point until the decision-page step. Owners, architects and contributors can request a second opinion on a **proposed** decision when Ask Atlas and agents are on and the organisation has saved its own AI key. The Designer trial does not cover reviewers. A reviewer makes one bounded provider call, returns up to five validated questions and token counts, writes nothing and does not sign off a lens. The function reads the saved decision and the main commit through the caller's RLS session. The outgoing digest uses the same ADR formatter and derived, visible What-changes rows as the decision page, over an explicit allowlist of saved decision fields, linked options, ratings, principles, goals and declared concerns. The cost rating and the Run cost row are withheld unless an owner opted into sharing; the extra estate context also excludes run cost. When sharing is off and an obvious currency amount occurs in saved free text, the function refuses the run; this check is not a guarantee of finding every money reference. The digest hash is returned, not persisted. No reviewer result is an approval, and no user can reach this backend until the decision-page step ships.

Deploy `llm-proxy` first, then `pnpm functions:deploy:review-agent`. The new proxy fields `requireOrgKey: true` and `modelTier: 'light'` are opt-in: every reviewer request sets the former, including after a key is removed mid-run; the Steward requests the latter. The Challenger uses `agentStandardModel` in platform configuration, or `LLM_PROXY_AGENT_STANDARD_MODEL`, or `claude-sonnet-5-5`; the Steward uses `lightModel`, or `LLM_PROXY_LIGHT_MODEL`, or `claude-haiku-5-5`. The Designer's model is unchanged. The proxy refuses an unknown tier and never uses the platform key or Designer trial for a reviewer. Organisation-key requests now record the caller's validated `runId` in `llm_proxy_requests`; no migration is needed. The proxy's upstream fetch is not tied to a browser abort, so leaving or stopping a client request discards the notes but may still use tokens.
