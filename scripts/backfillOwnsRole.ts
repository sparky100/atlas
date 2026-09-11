/**
 * One-off backfill (Prompt 7k item 2): `pnpm backfill:owns-role <modelId> <email> <password>`.
 *
 * `owns.role` replaces `owns.primary` for cardinality purposes; this fills
 * in `role` for every existing `owns` edge that predates this sprint.
 * `src/db/backfillOwnsRole.ts` does the actual matching and delta-building
 * (a real `relationship.update` commit, never a raw row edit — see that
 * module's own comment); this is just its CLI entrypoint, the same shape
 * `scripts/backfillCapabilityOrder.ts`'s own wrapper already uses.
 *
 * Takes a real owner/architect account's email/password, not a
 * service-role key — same reasoning as `backfillCapabilityOrder.ts`'s own
 * CLI comment: this writes real model data through `atlas.commit_deltas`,
 * which derives the commit's author from `auth.uid()` with no grant to
 * `service_role` at all (ADR-015/ADR-007).
 *
 * Must be run once per model that has `owns` edges predating this sprint
 * (idempotent — a repeat run on an already-migrated model is a safe
 * no-op) as part of releasing this migration: the SQL migration
 * (`20260911070000_owns_role.sql`) lands the new cardinality index, but
 * does not itself touch any row — this script is the data half.
 */
import { backfillOwnsRole } from '../src/db/backfillOwnsRole';
import { createSupabaseClient } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { isCliEntrypoint } from './isCliEntrypoint';

async function main(): Promise<void> {
  const [modelId, email, password] = process.argv.slice(2);
  if (!modelId || !email || !password) {
    console.error('Usage: pnpm backfill:owns-role <modelId> <email> <password>');
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

    const result = await backfillOwnsRole(supabase, { modelId, userId: userData.user.id });
    if (!result.ok) {
      console.error(`Could not backfill owns.role: ${result.message}`);
      process.exitCode = 1;
      return;
    }
    if (result.kind === 'nothing-to-backfill') {
      console.log(result.message);
      return;
    }
    console.log(`Backfilled role for ${String(result.backfilled)} owns edge${result.backfilled === 1 ? '' : 's'} in model ${modelId}, in commit ${result.commitId}:`);
    for (const candidate of result.candidates) {
      console.log(`  relationship ${candidate.relationshipId} -> role: ${candidate.role}`);
    }
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
