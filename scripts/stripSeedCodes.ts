/**
 * One-off remediation for ADR-020: `pnpm strip:seed-codes <modelId> <email> <password>`.
 *
 * Models seeded before src/db/seedFromMap.ts's ADR-020 fix have capability
 * elements whose `code` still equals the starter map item's own code —
 * pure seed leftover, fully recoverable via `attributes.templateRef` and
 * the `template_code` alias the same seed commit already writes. This
 * clears every such value, for the given model, in a single commit titled
 * "Strip seed-copied Reference codes from {sector} v{version}"
 * (src/db/stripSeedCodes.ts does the actual matching and delta-building;
 * this is just its CLI entrypoint — the same shape as
 * scripts/syncDescriptionsFromMap.ts's own thin wrapper around a
 * src/db function).
 *
 * Takes a real owner/architect account's email/password, not a service-role
 * key: `atlas.commit_deltas` derives the commit's author from `auth.uid()`
 * and has no grant to `service_role` at all (ADR-015: only owner/architect
 * commit directly to main; ADR-007: no fact without provenance) — there is
 * no way to write real model data except as a real signed-in member, by
 * design. This signs in with the anon-key client exactly the way the app
 * itself does, runs the strip, then signs out.
 */
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { stripSeedCodesFromMap } from '../src/db/stripSeedCodes';
import { isCliEntrypoint } from './isCliEntrypoint';

async function main(): Promise<void> {
  const [modelId, email, password] = process.argv.slice(2);
  if (!modelId || !email || !password) {
    console.error('Usage: pnpm strip:seed-codes <modelId> <email> <password>');
    process.exitCode = 1;
    return;
  }

  const env = loadEnv();
  const supabase = createSupabaseClient(env);

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

  try {
    const result = await stripSeedCodesFromMap(supabase, { modelId });
    if (!result.ok) {
      console.error(`Could not strip seed codes: ${result.message}`);
      process.exitCode = 1;
      return;
    }
    if (result.kind === 'nothing-to-strip') {
      console.log(result.message);
      return;
    }
    console.log(`Stripped ${String(result.stripped)} seed-copied code(s) for model ${modelId}, in commit ${result.commitId}.`);
  } finally {
    await supabase.auth.signOut();
  }
}

// Only run main() when this is the CLI entrypoint, not when a test imports something from this file.
if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
