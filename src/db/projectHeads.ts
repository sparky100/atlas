/**
 * The live model's head and each open change's own head, folded from the
 * same commit history `loadChangeSummary` reads — what the project page's
 * before/after panels (`src/ui/projects/projectBeforeAfterModel.ts`) compare.
 * Read-only; nothing here writes or stores a head.
 */
import type { UUID } from '../contracts/delta';
import type { Head } from '../engine/deltas';
import { foldFromGenesis } from '../engine/head';
import type { Client } from './client';
import { buildCommitLoader } from './commitLoader';
import type { BranchRow } from './types';

export interface ProjectHeads {
  today: Head;
  changes: { id: UUID; title: string; head: Head }[];
}

export async function loadProjectHeads(supabase: Client, modelId: UUID, mainHeadCommitId: UUID, changes: readonly BranchRow[]): Promise<ProjectHeads> {
  const loader = await buildCommitLoader(supabase, modelId);
  const today = foldFromGenesis(mainHeadCommitId, loader);
  const folded: ProjectHeads['changes'] = [];
  for (const change of changes) {
    if (!change.head_commit_id || change.head_commit_id === change.base_commit_id) continue; // nothing drafted yet: identical to today.
    try {
      folded.push({ id: change.id, title: change.title ?? change.name, head: foldFromGenesis(change.head_commit_id, loader) });
    } catch {
      // One change whose history can't be replayed must not blank the others (same stance as `loadChangeSummariesForModel`).
      continue;
    }
  }
  return { today, changes: folded };
}
