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
