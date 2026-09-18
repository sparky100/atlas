/**
 * F2-lite ("spreadsheet import as reconciliation") — the change page's own
 * "not in file" summary: reads back `sources.import_touched_element_ids`
 * for whichever `spreadsheet`-kind source this branch's own deltas carry
 * (`useChangeSummary.ts`'s own `sourcesById`, already loaded — no new query
 * to find the source itself), and offers a one-click "retire" per row,
 * which just adds an ordinary `lifecycleStatus: 'retired'` update to this
 * same draft branch (`commitToBranch`, exactly what any other edit on a
 * draft branch already does — no new engine capability).
 *
 * A no-op (`{ status: 'none' }`) when this branch carries no spreadsheet
 * source — every change page calls this hook, but only an import's own
 * change page ever shows anything from it.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { computeNotInFile, type NotInFileElement } from '../../capture/notInFile';
import { commitToBranch } from '../../db/commits';
import { listFactsForSubject } from '../../db/elements';
import { listContainersForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow, SourceRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type ImportSummaryState = { status: 'none' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; fileName: string; notInFile: NotInFileElement[] };

export interface UseImportSummaryResult {
  state: ImportSummaryState;
  /** `null` while a retire is in flight for that row — disables just that row's own button, not the whole list. */
  retiring: UUID | null;
  retire: (element: NotInFileElement) => Promise<void>;
}

function findSpreadsheetSource(sourcesById: ReadonlyMap<UUID, SourceRow>): SourceRow | null {
  for (const source of sourcesById.values()) {
    if (source.kind === 'spreadsheet') return source;
  }
  return null;
}

export function useImportSummary(orgId: UUID, modelId: UUID, branch: BranchRow | null, sourcesById: ReadonlyMap<UUID, SourceRow>, userId: UUID | null, reloadBranch: () => void): UseImportSummaryResult {
  const [state, setState] = useState<ImportSummaryState>({ status: 'none' });
  const [retiring, setRetiring] = useState<UUID | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    const spreadsheetSource = findSpreadsheetSource(sourcesById);
    if (!spreadsheetSource) {
      setState({ status: 'none' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const [systems, containers] = await Promise.all([listSystemsForLandscape(supabase, branch.head_commit_id), listContainersForLandscape(supabase, branch.head_commit_id)]);
      const touched = new Set(spreadsheetSource.import_touched_element_ids ?? []);
      setState({ status: 'ready', fileName: spreadsheetSource.name, notInFile: computeNotInFile(systems, containers, touched) });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not load this import’s summary.' });
    }
  }, [branch, sourcesById]);

  useEffect(() => {
    void load();
  }, [load]);

  const retire = useCallback(
    async (element: NotInFileElement) => {
      if (!branch || !userId) return;
      setRetiring(element.elementId);
      try {
        // A reviewer's own decision responding to the import, not something
        // the spreadsheet itself asserted — the same `manual` source every
        // other hand-made edit on this branch would use, never the
        // spreadsheet's own `sources` row.
        const [facts, source] = await Promise.all([listFactsForSubject(supabase, branch.head_commit_id, element.elementId), getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId })]);
        const lifecycleFact = facts.find((f) => f.attribute === 'lifecycleStatus');
        const previousDeltaId = lifecycleFact?.delta_id;
        if (previousDeltaId === undefined) throw new Error(`${element.name} has no recorded lifecycle status to retire from.`);
        const deltas: Delta[] = [{ kind: 'element.update', id: crypto.randomUUID(), elementId: element.elementId, elementType: element.elementType, attribute: 'lifecycleStatus', value: 'retired', previousDeltaId, sourceId: source.id, confidence: 1 }];
        const envelope: CommitEnvelope = { id: crypto.randomUUID(), branchId: branch.id, parentCommitId: branch.head_commit_id, mergedBranchHeadCommitId: null, kind: 'manual', title: `Retire ${element.name} — not in "${state.status === 'ready' ? state.fileName : 'the imported file'}"`, body: null, deltas };
        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
        if (!result.ok) throw new Error(result.message);
        reloadBranch();
      } catch (e) {
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Could not retire this element.' });
      } finally {
        setRetiring(null);
      }
    },
    [branch, userId, orgId, modelId, reloadBranch, state],
  );

  return { state, retiring, retire };
}
