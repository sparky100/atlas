import { useCallback, useMemo, useState } from 'react';
import type { CommitEnvelope, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { buildImportDeltas, type CurrentSupportsEdge, type MatchResolution } from '../../capture/buildImportCommit';
import type { ImportRelationshipRow } from '../../capture/importRelationshipRow';
import { computeNotInFile, type NotInFileElement } from '../../capture/notInFile';
import { matchImportRows, type MatchedImportRow } from '../../capture/matchImportRows';
import { ImportFileParseError, parseImportFile } from '../../capture/parseImportFile';
import { listAliasesForModel } from '../../db/aliases';
import { createChangeBranch, getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { commitToBranch } from '../../db/commits';
import { listAllUsesAndFlowsToEdges, listFactsForCommit } from '../../db/healthFindings';
import { listActorsForLandscape, listContainersForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { listAllSupportsEdges } from '../../db/modelHome';
import { createSpreadsheetSource } from '../../db/sources';
import { attributesRecord } from '../elements/attributesRecord';
import { supabase } from '../supabaseClient';

export type SpreadsheetImportStatus = 'idle' | 'loading' | 'review' | 'committing' | 'error';

/** Never sent to `commitToBranch` — see `buildResult`'s own doc comment below. */
const PREVIEW_SOURCE_ID: UUID = '00000000-0000-0000-0000-000000000000';

export interface SpreadsheetImportReview {
  fileName: string;
  detectedColumns: string[];
  previewRows: Record<string, unknown>[];
  matchedRows: MatchedImportRow[];
  parseErrors: { rowNumber: number; error: string }[];
  systems: ElementsHeadRow[];
  containers: ElementsHeadRow[];
  /** Import close-out: the optional "Relationships" sheet's own rows/errors — always empty for a CSV, or an XLSX with no such sheet. */
  relationshipRows: ImportRelationshipRow[];
  relationshipParseErrors: { rowNumber: number; error: string }[];
}

export interface UseSpreadsheetImportResult {
  status: SpreadsheetImportStatus;
  error: string | null;
  review: SpreadsheetImportReview | null;
  /** Every `'undecided'` row's own pick so far, keyed by `rowNumber` — the review screen writes to this via `resolveMatch`, `commit` reads it. */
  resolutions: ReadonlyMap<number, MatchResolution>;
  /** Live classification of every row, given the current `resolutions` — recomputed on every pick, this session's own "always available, never thrown" preview (`buildImportCommit.ts`'s own doc comment). */
  buildResult: ReturnType<typeof buildImportDeltas> | null;
  /** "Not in file" — every system/module in the model this file's rows never touched, given the current (possibly still-incomplete) picks. */
  notInFile: NotInFileElement[];
  loadFile: (file: File) => Promise<void>;
  resolveMatch: (rowNumber: number, choice: MatchResolution) => void;
  /** `null` if the commit couldn't proceed (still-unresolved rows, or a real failure — `error` explains which); the new branch's id on success. */
  commit: () => Promise<UUID | null>;
  reset: () => void;
}

/**
 * F2-lite ("spreadsheet import as reconciliation") — the whole load → match
 * → review → commit flow for one spreadsheet import, in one hook. Loads the
 * target branch's current systems/containers/capabilities/actors/aliases
 * once, at file-load time, matches every row against that snapshot
 * (`matchImportRows.ts`), and recomputes a live, non-throwing preview
 * (`buildImportDeltas`) on every render so the dialog always has fresh
 * counts/not-in-file/needs-pick state to show, whether or not every row is
 * resolved yet. Always commits to a **fresh** `record`-intent change branch
 * — "an import is recording something that already happened," the branch
 * intent's own wording (`branchIntent.ts`) — never to `main` directly and
 * never to an existing change branch.
 */
export function useSpreadsheetImport(modelId: UUID, orgId: UUID, userId: UUID | null): UseSpreadsheetImportResult {
  const [status, setStatus] = useState<SpreadsheetImportStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<SpreadsheetImportReview | null>(null);
  const [resolutions, setResolutions] = useState<Map<number, MatchResolution>>(new Map());
  const [factsByElementId, setFactsByElementId] = useState<Map<UUID, Map<string, FactsRow>>>(new Map());
  const [existsDeltaIdByElementId, setExistsDeltaIdByElementId] = useState<Map<UUID, UUID>>(new Map());
  const [actors, setActors] = useState<ElementsHeadRow[]>([]);
  const [aliasesByElementId, setAliasesByElementId] = useState<Map<UUID, readonly string[]>>(new Map());
  const [currentSupportsByElementId, setCurrentSupportsByElementId] = useState<Map<UUID, CurrentSupportsEdge[]>>(new Map());
  const [currentUsesFlowsToEdges, setCurrentUsesFlowsToEdges] = useState<RelationshipsHeadRow[]>([]);
  const [relationshipFactsByRelationshipId, setRelationshipFactsByRelationshipId] = useState<Map<UUID, Map<string, FactsRow>>>(new Map());

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
        const [systems, containers, capabilities, loadedActors, loadedAliasesByElementId, allFacts, supportsEdges, usesFlowsToEdges] = await Promise.all([
          listSystemsForLandscape(supabase, main.head_commit_id),
          listContainersForLandscape(supabase, main.head_commit_id),
          listCapabilitiesForMap(supabase, main.head_commit_id),
          listActorsForLandscape(supabase, main.head_commit_id),
          listAliasesForModel(supabase, modelId),
          listFactsForCommit(supabase, main.head_commit_id),
          listAllSupportsEdges(supabase, main.head_commit_id),
          listAllUsesAndFlowsToEdges(supabase, main.head_commit_id),
        ]);
        const matchedRows = matchImportRows({ rows: parsed.rows, systems, containers, capabilities, actors: loadedActors, aliasesByElementId: loadedAliasesByElementId });

        const facts = new Map<UUID, Map<string, FactsRow>>();
        const relationshipFacts = new Map<UUID, Map<string, FactsRow>>();
        for (const fact of allFacts) {
          if (fact.subject_type === 'element') {
            const forElement = facts.get(fact.subject_id) ?? new Map<string, FactsRow>();
            forElement.set(fact.attribute, fact);
            facts.set(fact.subject_id, forElement);
          } else {
            const forRelationship = relationshipFacts.get(fact.subject_id) ?? new Map<string, FactsRow>();
            forRelationship.set(fact.attribute, fact);
            relationshipFacts.set(fact.subject_id, forRelationship);
          }
        }
        setFactsByElementId(facts);
        setRelationshipFactsByRelationshipId(relationshipFacts);
        setExistsDeltaIdByElementId(new Map([...systems, ...containers].map((e) => [e.element_id, e.exists_delta_id])));
        setActors(loadedActors);
        setAliasesByElementId(loadedAliasesByElementId);
        setCurrentUsesFlowsToEdges(usesFlowsToEdges);

        // Import close-out: every matched system/module's own live `supports`
        // edges, grouped by `from`, for the capability-diff/demotion pass.
        const supportsByElementId = new Map<UUID, CurrentSupportsEdge[]>();
        for (const edge of supportsEdges) {
          const role = attributesRecord(edge.attributes).role;
          const forElement = supportsByElementId.get(edge.from_element_id) ?? [];
          forElement.push({ relationshipId: edge.relationship_id, capabilityId: edge.to_element_id, role: role === 'primary' ? 'primary' : 'secondary', roleDeltaId: relationshipFacts.get(edge.relationship_id)?.get('role')?.delta_id ?? edge.exists_delta_id });
          supportsByElementId.set(edge.from_element_id, forElement);
        }
        setCurrentSupportsByElementId(supportsByElementId);

        setReview({ fileName: parsed.fileName, detectedColumns: parsed.detectedColumns, previewRows: parsed.previewRows, matchedRows, parseErrors: parsed.errors, systems, containers, relationshipRows: parsed.relationshipRows, relationshipParseErrors: parsed.relationshipErrors });
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

  // Recomputed on every render (cheap — pure, in-memory) so a pick's effect
  // on counts/not-in-file is immediate; never thrown, so this is safe to
  // call before every row has a resolution yet (`buildImportCommit.ts`'s
  // own doc comment). `PREVIEW_SOURCE_ID` never reaches a real delta — this
  // result is for the dialog's own live counts only; `commit` below throws
  // this away and rebuilds once more with the real `sources` row's id.
  const buildResult = useMemo(() => {
    if (!review) return null;
    return buildImportDeltas({
      matchedRows: review.matchedRows,
      resolutions,
      fileName: review.fileName,
      sourceId: PREVIEW_SOURCE_ID,
      factsByElementId,
      existsDeltaIdByElementId,
      currentSupportsByElementId,
      relationshipRows: review.relationshipRows,
      systems: review.systems,
      containers: review.containers,
      actors,
      aliasesByElementId,
      currentUsesFlowsToEdges,
      relationshipFactsByRelationshipId,
    });
  }, [review, resolutions, factsByElementId, existsDeltaIdByElementId, currentSupportsByElementId, actors, aliasesByElementId, currentUsesFlowsToEdges, relationshipFactsByRelationshipId]);

  const notInFile = useMemo(() => {
    if (!review || !buildResult) return [];
    return computeNotInFile(review.systems, review.containers, new Set(buildResult.touchedElementIds));
  }, [review, buildResult]);

  const commit = useCallback(async (): Promise<UUID | null> => {
    if (!review || !userId || !buildResult) return null;
    if (buildResult.rows.some((r) => r.outcome.status === 'needs-pick' || r.outcome.status === 'blocked')) return null;
    if (buildResult.relationshipRows.some((r) => r.outcome.status === 'blocked')) return null;
    setError(null);
    setStatus('committing');
    try {
      const main = await getMainBranch(supabase, modelId);
      if (!main) throw new Error('This model has no main to import into.');

      // Confirmed same-as picks are staged as `pending_aliases`, not written
      // as real `aliases` rows yet — F2-lite's import close-out: an alias
      // only becomes real once this change actually merges
      // (`mergeApprovedRequest`), never on a change that's cancelled or
      // rejected. `buildResult.aliasesToWrite` doesn't depend on the real
      // `sourceId` (only `resolveIdentity`/matching do), so it's already
      // correct here, before the source row even exists.
      const source = await createSpreadsheetSource(supabase, { id: crypto.randomUUID(), orgId, modelId, createdBy: userId, fileName: review.fileName, touchedElementIds: buildResult.touchedElementIds, pendingAliases: buildResult.aliasesToWrite });
      // `buildResult` was computed with a placeholder `sourceId` (real
      // `sources` row didn't exist yet, and rebuilding it would just be the
      // same pure computation over unchanged inputs) — the deltas' own
      // `sourceId` needs the real row's id, so every delta is rebuilt once
      // more, now that it exists.
      const final = buildImportDeltas({
        matchedRows: review.matchedRows,
        resolutions,
        fileName: review.fileName,
        sourceId: source.id,
        factsByElementId,
        existsDeltaIdByElementId,
        currentSupportsByElementId,
        relationshipRows: review.relationshipRows,
        systems: review.systems,
        containers: review.containers,
        actors,
        aliasesByElementId,
        currentUsesFlowsToEdges,
        relationshipFactsByRelationshipId,
      });
      if (final.deltas.length === 0) {
        setError('Nothing to import — every row was already up to date.');
        setStatus('review');
        return null;
      }

      const branch = await createChangeBranch(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        name: `import-${review.fileName.replace(/\.[^./]+$/, '')}-${crypto.randomUUID().slice(0, 8)}`,
        title: `Imported from ${review.fileName}`,
        createdBy: userId,
        mainHeadCommitId: main.head_commit_id,
        intent: 'record',
      });

      const warnings = final.rows.flatMap((r) => r.warnings);
      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: branch.head_commit_id,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: `Import ${String(final.rows.filter((r) => r.outcome.status === 'new').length)} new, ${String(final.rows.filter((r) => r.outcome.status === 'changed').length)} changed from "${review.fileName}"`,
        body: warnings.length > 0 ? warnings.join('\n') : null,
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
  }, [review, resolutions, buildResult, modelId, orgId, userId, factsByElementId, existsDeltaIdByElementId, currentSupportsByElementId, actors, aliasesByElementId, currentUsesFlowsToEdges, relationshipFactsByRelationshipId]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setReview(null);
    setResolutions(new Map());
  }, []);

  return { status, error, review, resolutions, buildResult, notInFile, loadFile, resolveMatch, commit, reset };
}
