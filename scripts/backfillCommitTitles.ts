/**
 * One-off backfill (Sprint U4-1 B1): `pnpm backfill:commit-titles [modelId]`.
 * Every commit made before this sprint has whatever a hook happened to
 * type by hand sitting in the newly-renamed `title` column ("Add
 * relationship", `Edit PowerON`). This regenerates `title` for every
 * `manual` commit using the same engine (`src/engine/describeEnvelope.ts`)
 * every hook now calls on its own commits going forward.
 * `merge`/`template_seed`/`genesis` commits are left untouched — same
 * scoping `describeEnvelope`'s own module comment gives for why those
 * three keep their own established phrasing.
 *
 * Name resolution: `describeEnvelope`'s `nameLookup` needs each element's
 * name *as of just before* the commit being described, not its name
 * today — a later rename would otherwise make an older commit's title
 * wrong. This script gets that by replaying every commit's own
 * `element.create`/`element.update(name)` deltas, one model at a time, in
 * `created_at` order into a running id -> name map, computing each manual
 * commit's title from the map as it stood immediately before that
 * commit's own deltas are folded in. `created_at` (a real timestamp) is
 * used rather than `depth`, which resets at every branch's own fork point
 * and so gives no single, consistent ordering across a model's branches —
 * exactly the ordering this replay needs and the only one commits carries
 * that has it. This is a *display-string* backfill, not model data: the
 * one edge case it doesn't handle perfectly is two branches that both
 * renamed the same element differently before either merged — the map
 * only tracks one branch's timeline through their shared history, so a
 * commit's title in the "other" branch's line can end up using the wrong
 * one's name in that narrow window. Accepted for a one-off tool backfilling
 * cosmetic titles, not the underlying facts.
 */
import type { Delta, UUID } from '../src/contracts/delta';
import type { DeltaRow } from '../src/contracts/rows';
import { fromDeltaRow } from '../src/contracts/rows';
import { createServiceRoleClient, type Client } from '../src/db/client';
import { loadEnv } from '../src/db/env';
import { selectAll } from '../src/db/selectAll';
import { describeEnvelope } from '../src/engine/describeEnvelope';
import { isCliEntrypoint } from './isCliEntrypoint';

interface CommitScanRow {
  id: UUID;
  kind: string;
  title: string;
  created_at: string;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
}

async function backfillModel(supabase: Client, modelId: UUID): Promise<BackfillResult> {
  // Ordered `(created_at, id)`: `created_at` alone isn't guaranteed unique
  // (selectAll's own module comment on why pagination needs a unique
  // order), and `id` is a UUID v7 — itself time-ordered — so ties break the
  // same direction they'd already sort anyway.
  const commitsQuery = supabase.from('commits').select('id, kind, title, created_at', { count: 'exact' }).eq('model_id', modelId).order('created_at').order('id');
  const commits = await selectAll<CommitScanRow>(commitsQuery);

  const deltasQuery = supabase.from('deltas').select('*', { count: 'exact' }).eq('model_id', modelId).order('commit_id').order('seq');
  const deltaRows = await selectAll<DeltaRow>(deltasQuery);

  const deltasByCommit = new Map<UUID, Delta[]>();
  for (const row of deltaRows) {
    const delta = fromDeltaRow(row);
    const existing = deltasByCommit.get(row.commit_id);
    if (existing) existing.push(delta);
    else deltasByCommit.set(row.commit_id, [delta]);
  }

  const names = new Map<UUID, string>();
  const nameLookup = (elementId: UUID): string | undefined => names.get(elementId);

  let updated = 0;
  for (const commit of commits) {
    const deltas = deltasByCommit.get(commit.id) ?? [];

    if (commit.kind === 'manual') {
      const title = describeEnvelope(deltas, nameLookup);
      if (title !== commit.title) {
        const { error } = await supabase.from('commits').update({ title }).eq('id', commit.id);
        if (error) throw new Error(`updating commit ${commit.id}: ${error.message}`);
        updated++;
      }
    }

    // Advance the running name map with this commit's own deltas
    // regardless of kind — a name set by a `template_seed` or `merge`
    // commit still has to be visible to a later `manual` commit's title.
    for (const delta of deltas) {
      if (delta.kind === 'element.create') names.set(delta.elementId, delta.name);
      else if (delta.kind === 'element.update' && delta.attribute === 'name') names.set(delta.elementId, delta.value);
    }
  }

  return { scanned: commits.length, updated };
}

/** Exported so a test (or a future re-run) can call it directly against a real Supabase, same shape as scripts/publishCapabilityMap.ts's own `publishCapabilityMap`. */
export async function backfillCommitTitles(supabase: Client, modelId?: UUID): Promise<BackfillResult> {
  let modelIds: UUID[];
  if (modelId) {
    modelIds = [modelId];
  } else {
    const modelsQuery = supabase.from('models').select('id', { count: 'exact' }).order('id');
    const models = await selectAll<{ id: UUID }>(modelsQuery);
    modelIds = models.map((m) => m.id);
  }

  let scanned = 0;
  let updated = 0;
  for (const id of modelIds) {
    const result = await backfillModel(supabase, id);
    scanned += result.scanned;
    updated += result.updated;
  }
  return { scanned, updated };
}

async function main(): Promise<void> {
  const [modelIdArg] = process.argv.slice(2);
  const env = loadEnv();
  const supabase = createServiceRoleClient(env);
  const { scanned, updated } = await backfillCommitTitles(supabase, modelIdArg);
  console.log(`Scanned ${String(scanned)} commit(s)${modelIdArg ? ` for model ${modelIdArg}` : ' across every model'}; regenerated ${String(updated)} title(s).`);
}

// Only run main() when this is the CLI entrypoint, not when a test imports backfillCommitTitles.
if (isCliEntrypoint(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
