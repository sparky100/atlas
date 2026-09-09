/**
 * One-off backfill (Sprint U4-1 C1, tightened after review):
 * `pnpm backfill:capability-order <modelId> <email> <password>`.
 *
 * Every capability now gets an explicit `attributes.order` at creation
 * (`src/ui/capabilityMap/useCapabilityCreate.ts`); this fills one in for
 * capabilities created before that change — hand-added ones, and ones
 * seeded from a starter map before its content carried `order` at all.
 * `src/db/backfillCapabilityOrder.ts` does the actual matching and
 * delta-building; this is just its CLI entrypoint — the same shape as
 * `scripts/syncDescriptionsFromMap.ts`'s own thin wrapper.
 *
 * Takes a real owner/architect account's email/password, not a
 * service-role key: `order` is real model data, and `atlas.commit_deltas`
 * derives the commit's author from `auth.uid()` with no grant to
 * `service_role` at all (ADR-015/ADR-007) — there is no way to write it
 * except as a real signed-in member, by design. This signs in with the
 * anon-key client exactly the way the app itself does, runs the backfill,
 * then signs out.
 */
import { backfillCapabilityOrder } from '../src/db/backfillCapabilityOrder';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';

async function main(): Promise<void> {
  const [modelId, email, password] = process.argv.slice(2);
  if (!modelId || !email || !password) {
    console.error('Usage: pnpm backfill:capability-order <modelId> <email> <password>');
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const supabase = createSupabaseClient(env);

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

  try {
    const { data: userData, error: getUserError } = await supabase.auth.getUser();
    if (getUserError) throw new Error(`could not read the signed-in user: ${getUserError.message}`);

    const result = await backfillCapabilityOrder(supabase, { modelId, userId: userData.user.id });
    if (!result.ok) {
      console.error(`Could not backfill order: ${result.message}`);
      process.exitCode = 1;
      return;
    }
    if (result.kind === 'nothing-to-backfill') {
      console.log(result.message);
      return;
    }
    console.log(`Backfilled order for ${String(result.backfilled)} capabilit${result.backfilled === 1 ? 'y' : 'ies'} in model ${modelId}, in commit ${result.commitId}.`);
  } finally {
    await supabase.auth.signOut();
  }
}

// Only run main() when this is the CLI entrypoint, not when a test imports something from this file.
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
