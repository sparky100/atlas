import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { FactsRow } from '../../contracts/rows';
import { buildImportDeltas, type MatchResolution } from '../../capture/buildImportCommit';
import { matchImportRows, type MatchedImportRow } from '../../capture/matchImportRows';
import { ImportFileParseError, parseImportFile } from '../../capture/parseImportFile';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { commitToBranch } from '../../db/commits';
import { listSystemsForLandscape } from '../../db/landscape';
import { listFactsForCommit } from '../../db/healthFindings';
import { createSpreadsheetSource } from '../../db/sources';
import { supabase } from '../supabaseClient';

export type SpreadsheetImportStatus = 'idle' | 'loading' | 'review' | 'committing' | 'error';

export interface SpreadsheetImportReview {
  fileName: string;
  matchedRows: MatchedImportRow[];
  parseErrors: { rowNumber: number; error: string }[];
}

export interface UseSpreadsheetImportResult {
  status: SpreadsheetImportStatus;
  error: string | null;
  review: SpreadsheetImportReview | null;
  /** Every `ambiguous` row's own pick so far, keyed by `rowNumber` — the review screen writes to this via `resolveMatch`, `commit` reads it. */
  resolutions: ReadonlyMap<number, MatchResolution>;
  loadFile: (file: File) => Promise<void>;
  resolveMatch: (rowNumber: number, choice: MatchResolution) => void;
  /** `null` if the commit couldn't proceed (still-unresolved rows, or a real failure — `error` explains which); the new branch's id on success. */
  commit: () => Promise<UUID | null>;
  reset: () => void;
}

/**
 * F2 (narrowed capture pipeline), Phase 1 — the whole load → match → review
 * → commit flow for one spreadsheet import, in one hook (this session's
 * plan). Loads the target branch's current systems/capabilities/facts
 * once, at file-load time, matches every row against that snapshot
 * (`matchImportRows.ts`, deterministic only in Phase 1), and only builds
 * real deltas (`buildImportCommit.ts`) once every ambiguous row has a
 * pick. Always commits to a **fresh** `record`-intent change branch — "an
 * import is recording something that already happened," the branch
 * intent's own wording (`branchIntent.ts`) — never to `main` directly and
 * never to an existing change branch, so this is never a caller other UI
 * needs to reason about mid-edit.
 */
export function useSpreadsheetImport(modelId: UUID, orgId: UUID, userId: UUID | null): UseSpreadsheetImportResult {
  const [status, setStatus] = useState<SpreadsheetImportStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<SpreadsheetImportReview | null>(null);
  const [resolutions, setResolutions] = useState<Map<number, MatchResolution>>(new Map());

  const loadFile = useCallback(
    async (file: File) => {
      setError(null);
      setReview(null);
      setResolutions(new Map());
      setStatus('loading');
      try {
        const parsed = await parseImportFile(file);
        const main = await getMainBranch(supabase, modelId);
        if (!main) throw new Error('This model has no main to import into.');
        const [systems, capabilities] = await Promise.all([listSystemsForLandscape(supabase, main.head_commit_id), listCapabilitiesForMap(supabase, main.head_commit_id)]);
        const matchedRows = matchImportRows(parsed.rows, systems, capabilities);
        setReview({ fileName: parsed.fileName, matchedRows, parseErrors: parsed.errors });
        setStatus('review');
      } catch (e) {
        const message = e instanceof ImportFileParseError ? e.message : e instanceof Error ? e.message : 'Could not read this file.';
        setError(message);
        setStatus('error');
      }
    },
    [modelId],
  );

  const resolveMatch = useCallback((rowNumber: number, choice: MatchResolution) => {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(rowNumber, choice);
      return next;
    });
  }, []);

  const commit = useCallback(async (): Promise<UUID | null> => {
    if (!review || !userId) return null;
    setError(null);
    setStatus('committing');
    try {
      // Every *matched* (or ambiguous-resolved-to-existing) system's own
      // current facts — one bulk read for the whole import, not one
      // query per row (CLAUDE.md rule 8: a per-row `.in()` would grow
      // with the file's own size). `listFactsForCommit` is already this
      // "everything for a commit, filtered client-side" shape
      // (healthFindings.ts's own module comment on why).
      const main = await getMainBranch(supabase, modelId);
      if (!main) throw new Error('This model has no main to import into.');
      const allFacts = await listFactsForCommit(supabase, main.head_commit_id);
      const factsByElementId = new Map<UUID, Map<string, FactsRow>>();
      for (const fact of allFacts) {
        if (fact.subject_type !== 'element') continue;
        const forElement = factsByElementId.get(fact.subject_id) ?? new Map<string, FactsRow>();
        forElement.set(fact.attribute, fact);
        factsByElementId.set(fact.subject_id, forElement);
      }
      const systems = await listSystemsForLandscape(supabase, main.head_commit_id);
      const existsDeltaIdByElementId = new Map<UUID, UUID>(systems.map((s) => [s.element_id, s.exists_delta_id]));

      const source = await createSpreadsheetSource(supabase, { id: crypto.randomUUID(), orgId, modelId, createdBy: userId, fileName: review.fileName });
      const final = buildImportDeltas({ matchedRows: review.matchedRows, resolutions, sourceId: source.id, factsByElementId, existsDeltaIdByElementId });
      if (final.deltas.length === 0) {
        // A harmless orphan `sources` row, same as `getOrCreateManualSource`
        // creating one before a person's first real edit — provenance rows
        // existing with nothing pointing at them yet isn't a new shape.
        setError(final.warnings.length > 0 ? final.warnings.join(' ') : 'Nothing to import — every row was already up to date.');
        setStatus('review');
        return null;
      }

      const branch = await createChangeBranch(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        name: `import-${review.fileName.replace(/\.[^./]+$/, '')}-${crypto.randomUUID().slice(0, 8)}`,
        title: `Import: ${review.fileName}`,
        description: `Imported from "${review.fileName}"${final.warnings.length > 0 ? `\n\n${final.warnings.join('\n')}` : ''}`,
        createdBy: userId,
        mainHeadCommitId: main.head_commit_id,
        intent: 'record',
      });

      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: `Import ${String(final.deltas.filter((d: Delta) => d.kind === 'element.create').length)} system(s) from "${review.fileName}"`,
        body: null,
        deltas: final.deltas,
      };
      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId: branch.head_commit_id, envelope });
      if (!result.ok) throw new Error(result.message);

      return branch.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not commit this import.');
      setStatus('review');
      return null;
    }
  }, [review, resolutions, modelId, orgId, userId]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setReview(null);
    setResolutions(new Map());
  }, []);

  return { status, error, review, resolutions, loadFile, resolveMatch, commit, reset };
}
