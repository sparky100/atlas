/**
 * Builds a src/engine `CommitLoader` from Postgres. This is the one place
 * the engine's pure world touches the database's actual rows.
 *
 * v1 fetches every commit and delta for a model and holds them in memory.
 * That's the deliberately simple option SPEC-data-model.md §6.5 allows —
 * the "replay only since the nearest retained snapshot" optimisation is
 * named there as a later refinement, not required now. It's fine for a
 * model sized like this product's actual users (a landscape with one or
 * two architects, not a firehose of commits); it stops being fine long
 * before "replay from a snapshot" would need to exist anyway, at which
 * point this function's signature doesn't have to change, only its body.
 */
import type { Client } from './client';
import type { UUID } from '../contracts/delta';
import { fromDeltaRow, type CommitRow, type DeltaRow } from '../contracts/rows';
import type { CommitLoader, CommitNode } from '../engine/head';

/**
 * `numeric` columns can arrive from PostgREST as strings rather than
 * numbers depending on client/server version — DeltaRow's `confidence` type
 * says `number`, but that's the contract, not a guarantee about what a
 * live HTTP response actually contains. `Number(...)` on an already-number
 * value is a harmless no-op; this coercion is defensive, not asserting a
 * type error, hence the inline disable rather than removing it.
 */
function coerceDeltaRow(row: DeltaRow): DeltaRow {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- defensive against PostgREST returning numeric as a string; see comment above.
  return { ...row, confidence: Number(row.confidence) };
}

export async function buildCommitLoader(supabase: Client, modelId: UUID): Promise<CommitLoader> {
  const [{ data: commitRows, error: commitsError }, { data: deltaRows, error: deltasError }] = await Promise.all([
    supabase.from('commits').select('*').eq('model_id', modelId).overrideTypes<CommitRow[], { merge: false }>(),
    supabase.from('deltas').select('*').eq('model_id', modelId).order('seq', { ascending: true }).overrideTypes<DeltaRow[], { merge: false }>(),
  ]);
  if (commitsError) throw new Error(`buildCommitLoader: failed to load commits: ${commitsError.message}`);
  if (deltasError) throw new Error(`buildCommitLoader: failed to load deltas: ${deltasError.message}`);

  const deltasByCommit = new Map<UUID, DeltaRow[]>();
  for (const row of deltaRows) {
    const list = deltasByCommit.get(row.commit_id);
    if (list) list.push(row);
    else deltasByCommit.set(row.commit_id, [row]);
  }

  const nodes = new Map<UUID, CommitNode>();
  for (const row of commitRows) {
    const deltaRowsForCommit = deltasByCommit.get(row.id) ?? [];
    nodes.set(row.id, {
      ...row,
      // head_hash is bytea; not consumed until materialisation exists, so
      // its exact PostgREST wire encoding (hex vs base64) isn't resolved
      // here — left as whatever comes back, unused.
      deltas: deltaRowsForCommit.map((r) => fromDeltaRow(coerceDeltaRow(r))),
    });
  }

  return (id) => nodes.get(id);
}
