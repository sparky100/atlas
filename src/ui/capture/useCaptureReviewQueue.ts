import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementType, UUID } from '../../contracts/delta';
import type { CandidateDecision, CandidateDecisionDetail, CaptureCandidate, CaptureJob } from '../../contracts/capture';
import { buildPromotionEnvelope } from '../../capture/buildPromotionEnvelope';
import { loadCaptureDraftHead } from '../../capture/loadCaptureDraftHead';
import { loadTargetBranchHead, type LoadedTargetBranch } from '../../capture/loadTargetBranchHead';
import { createChangeBranch, getMainBranch, listChangeBranches } from '../../db/branches';
import { applyCaptureDecisions, listCaptureCandidates, stageCaptureDecisions, type CaptureDecisionInput } from '../../db/captureCandidates';
import { getCaptureJob } from '../../db/captureJobs';
import { getOrCreateManualSource } from '../../db/sources';
import { envelopeToDeltaRows, type ElementsHeadRow, type RelationshipsHeadRow } from '../../contracts/rows';
import { selectAll } from '../../db/selectAll';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

const ELEMENTS_HEAD_COLUMNS = 'element_id, element_type, name, parent_id, attributes, exists_delta_id';
const RELATIONSHIPS_HEAD_COLUMNS = 'relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id';

/** Main's own current elements/relationships, for `update`/`conflict`'s own "main now" column (SPEC §10) — main is the one branch with a real materialised projection to read (a change branch, including the reviewer's own not-yet-chosen target, has none — §3.5), and CLAUDE.md rule 8's reference shape (`elementSearch.ts`'s own `loadSearchPool`): query the model/commit scope once via `selectAll`, never a growing `.in()` keyed on this job's own candidate ids. */
async function loadMainNowMaps(commitId: UUID | null): Promise<{ elements: Map<UUID, ElementsHeadRow>; relationships: Map<UUID, RelationshipsHeadRow> }> {
  if (commitId === null) return { elements: new Map(), relationships: new Map() };
  const [elementRows, relationshipRows] = await Promise.all([
    selectAll<ElementsHeadRow>(supabase.from('elements_head').select(ELEMENTS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('element_id')),
    selectAll<RelationshipsHeadRow>(supabase.from('relationships_head').select(RELATIONSHIPS_HEAD_COLUMNS, { count: 'exact' }).eq('commit_id', commitId).order('relationship_id')),
  ]);
  return { elements: new Map(elementRows.map((r) => [r.element_id, r])), relationships: new Map(relationshipRows.map((r) => [r.relationship_id, r])) };
}

export type CaptureReviewStatus = 'loading' | 'idle' | 'error' | 'applying';

export interface UseCaptureReviewQueueResult {
  status: CaptureReviewStatus;
  error: string | null;
  job: CaptureJob | null;
  candidates: CaptureCandidate[];
  /** Draft `change` branches on this model — the only kind/status `apply_capture_decisions` accepts as a target (`loadTargetBranchHead.ts`'s own precondition), so this list is pre-filtered rather than left for the picker to filter. */
  changeBranches: BranchRow[];
  /** Main's own current row for a matched candidate's `draftSubjectId` — the "main now" side of `update`/`conflict`'s two/three-column display (SPEC §10). Empty maps while main has no commits yet. */
  mainElementById: Map<UUID, ElementsHeadRow>;
  mainRelationshipById: Map<UUID, RelationshipsHeadRow>;
  targetBranchId: UUID | null;
  setTargetBranchId: (id: UUID | null) => void;
  /** Creates a fresh draft change branch to promote into, for a reviewer with no existing one yet — mirrors `useChanges.ts`'s own `createChange`, narrowed to what this page needs (a name; intent fixed at `'record'`, matching a capture promotion's own nature). */
  createTargetBranch: (name: string) => Promise<UUID | null>;
  /** One `stage_capture_decisions` call per action (SPEC §8.2), never batched behind a flush button — optimistic local update first, reverted via `reload()` if the call fails. */
  decide: (candidateId: UUID, decision: CandidateDecision | null, decisionDetail?: CandidateDecisionDetail | null) => void;
  /** The `confirm` class's own `x` multi-select + `r` exclude (SPEC §10) — one staging call for the whole batch. */
  decideMany: (entries: readonly { candidateId: UUID; decision: CandidateDecision | null; decisionDetail?: CandidateDecisionDetail | null }[]) => void;
  /** Builds and applies the promotion envelope for every decided-but-not-yet-promoted candidate (⌘/Ctrl+Enter, SPEC §8.2) — returns the count actually promoted, or `null` on failure/no target chosen. */
  apply: () => Promise<{ appliedCount: number } | null>;
  /**
   * The `m` picker's own search (SPEC §10: "picker prefilled with `similar`,
   * then search") — a case-insensitive substring match over the *target*
   * branch's own current elements of `elementType`, since a merge target
   * has to exist on `targetHead` at apply time (`buildPromotionEnvelope.ts`'s
   * own check) and a change branch has no materialised `elements_head` row
   * to search the way `src/db/elementSearch.ts` does for main (§3.5) —
   * this instead searches the already-folded `Head` in memory, lazily
   * loaded once per `targetBranchId` and cached. `null` (not `[]`) when no
   * target is chosen yet, so the picker can say so rather than reading as
   * "no matches."
   */
  searchTargetElements: (elementType: ElementType, query: string) => Promise<{ elementId: UUID; name: string; parentName: string | null }[] | null>;
  reload: () => void;
}

function tallyDecisions(candidates: readonly CaptureCandidate[]): Record<string, number> {
  const tally: Record<string, number> = { accepted: 0, rejected: 0, merged: 0, edited: 0, split: 0 };
  for (const c of candidates) if (c.decision !== null) tally[c.decision] = (tally[c.decision] ?? 0) + 1;
  return tally;
}

/**
 * F2 (full K1) PR15: the capture review queue's own data + actions for one
 * job — job header, every candidate, the target-branch picker's own
 * options, per-action staging, and the apply pipeline
 * (`loadCaptureDraftHead`/`loadTargetBranchHead`/`getOrCreateManualSource`/
 * `buildPromotionEnvelope`/`envelopeToDeltaRows`/`applyCaptureDecisions` —
 * PR8's own client-side pre-check pipeline, called here for the first time
 * from a real UI rather than only from `applyCaptureDecisions.integration.test.ts`).
 */
export function useCaptureReviewQueue(modelId: UUID, orgId: UUID, jobId: UUID, userId: UUID | null): UseCaptureReviewQueueResult {
  const [status, setStatus] = useState<CaptureReviewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<CaptureJob | null>(null);
  const [candidates, setCandidates] = useState<CaptureCandidate[]>([]);
  const [changeBranches, setChangeBranches] = useState<BranchRow[]>([]);
  const [mainHeadCommitId, setMainHeadCommitId] = useState<UUID | null>(null);
  const [mainElementById, setMainElementById] = useState<Map<UUID, ElementsHeadRow>>(new Map());
  const [mainRelationshipById, setMainRelationshipById] = useState<Map<UUID, RelationshipsHeadRow>>(new Map());
  const [targetBranchId, setTargetBranchId] = useState<UUID | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const targetSeededRef = useRef(false);
  const targetHeadCacheRef = useRef<{ branchId: UUID; promise: Promise<LoadedTargetBranch> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus((s) => (s === 'applying' ? s : 'loading'));
    getMainBranch(supabase, modelId)
      .then((main) =>
        Promise.all([getCaptureJob(supabase, jobId), listCaptureCandidates(supabase, jobId), listChangeBranches(supabase, modelId), loadMainNowMaps(main?.head_commit_id ?? null)]).then(([jobRow, candidateRows, branches, mainNow]) => ({
          jobRow,
          candidateRows,
          branches,
          mainNow,
          mainHeadCommitId: main?.head_commit_id ?? null,
        })),
      )
      .then(({ jobRow, candidateRows, branches, mainNow, mainHeadCommitId: loadedMainHeadCommitId }) => {
        if (cancelled) return;
        setJob(jobRow);
        setCandidates(candidateRows);
        setChangeBranches(branches.filter((b) => b.status === 'draft'));
        setMainHeadCommitId(loadedMainHeadCommitId);
        setMainElementById(mainNow.elements);
        setMainRelationshipById(mainNow.relationships);
        // Seeded once, from the job's own "convenience default for the next
        // session" (SPEC §3.2) — never overwritten by a later reload, so a
        // reviewer's own in-progress pick (or a freshly created branch) is
        // never silently reset back to the job's stale default.
        if (!targetSeededRef.current) {
          targetSeededRef.current = true;
          setTargetBranchId(jobRow?.targetBranchId ?? null);
        }
        setStatus('idle');
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load this capture review.');
          setStatus('error');
          reportError("Couldn't load this capture review.", e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, jobId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const stageMany = useCallback((entries: readonly CaptureDecisionInput[]) => {
    if (entries.length === 0) return;
    const byId = new Map(entries.map((e) => [e.candidateId, e]));
    setCandidates((prev) =>
      prev.map((c) => {
        const entry = byId.get(c.id);
        return entry ? { ...c, decision: entry.decision, decisionDetail: entry.decisionDetail } : c;
      }),
    );
    void stageCaptureDecisions(supabase, jobId, entries).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not save that decision.');
      reportError("Couldn't save a review decision.", e);
      reload();
    });
  }, [jobId, reload]);

  const decide = useCallback(
    (candidateId: UUID, decision: CandidateDecision | null, decisionDetail: CandidateDecisionDetail | null = null) => {
      stageMany([{ candidateId, decision, decisionDetail }]);
    },
    [stageMany],
  );

  const decideMany = useCallback(
    (entries: readonly { candidateId: UUID; decision: CandidateDecision | null; decisionDetail?: CandidateDecisionDetail | null }[]) => {
      stageMany(entries.map((e) => ({ candidateId: e.candidateId, decision: e.decision, decisionDetail: e.decisionDetail ?? null })));
    },
    [stageMany],
  );

  const createTargetBranch = useCallback(
    async (name: string): Promise<UUID | null> => {
      if (!userId || !mainHeadCommitId) {
        setError('This model has no commits yet — there is nothing to base a change on.');
        return null;
      }
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setError('Name cannot be empty.');
        return null;
      }
      try {
        const branch = await createChangeBranch(supabase, { id: crypto.randomUUID(), orgId, modelId, name: trimmed, createdBy: userId, mainHeadCommitId, intent: 'record' });
        setChangeBranches((prev) => [branch, ...prev]);
        setTargetBranchId(branch.id);
        return branch.id;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create this change.');
        reportError("Couldn't create a target change.", e);
        return null;
      }
    },
    [modelId, orgId, userId, mainHeadCommitId],
  );

  const apply = useCallback(async (): Promise<{ appliedCount: number } | null> => {
    if (!job?.resultingBranchId) {
      setError('This job has no draft to promote from.');
      return null;
    }
    if (!targetBranchId) {
      setError('Choose a target change first.');
      return null;
    }
    if (!userId) {
      setError('You must be signed in to apply review decisions.');
      return null;
    }
    setStatus('applying');
    setError(null);
    try {
      const toPromote = candidates.filter((c) => c.decision !== null && c.promotedSubjectId === null);
      const draftHead = await loadCaptureDraftHead(supabase, modelId, job.resultingBranchId);
      const { head: targetHead, headCommitId } = await loadTargetBranchHead(supabase, modelId, targetBranchId);
      const reviewerSource = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
      const { deltas, promotedSubjectIdBySeq, aliasRows, resolvedConflicts } = buildPromotionEnvelope({
        candidates: toPromote,
        draftHead,
        targetHead,
        reviewerSourceId: reviewerSource.id,
        mintId: () => crypto.randomUUID(),
      });
      const commitId = crypto.randomUUID();
      const commitTitle = `Capture review: ${job.inputName}`;
      const deltaRows = envelopeToDeltaRows({ id: commitId, branchId: targetBranchId, parentCommitId: headCommitId, mergedBranchHeadCommitId: null, kind: 'manual', title: commitTitle, body: null, deltas }, { orgId, modelId, createdBy: userId });
      const candidateOutcomes: { candidateId: UUID; promotedSubjectId: UUID }[] = [];
      for (const c of toPromote) {
        const promotedSubjectId = promotedSubjectIdBySeq.get(c.seq);
        if (promotedSubjectId !== undefined) candidateOutcomes.push({ candidateId: c.id, promotedSubjectId });
      }

      await applyCaptureDecisions(supabase, {
        jobId: job.id,
        targetBranchId,
        commitId,
        commitTitle,
        commitBody: null,
        deltas: deltaRows,
        aliasRows: aliasRows.map((a) => ({ id: a.id, elementId: a.elementId, aliasValue: a.aliasValue, aliasType: a.aliasType, sourceId: a.sourceId, confidence: a.confidence })),
        candidateOutcomes,
        resolvedConflicts: resolvedConflicts.map((r) => ({ id: r.id, winningDeltaId: r.winningDeltaId, discardedDeltaId: r.discardedDeltaId, rationale: r.rationale })),
        stats: { decided: tallyDecisions(toPromote) },
      });
      setStatus('idle');
      reload();
      return { appliedCount: toPromote.length };
    } catch (e) {
      setStatus('idle');
      const message = e instanceof Error ? e.message : 'Could not apply these decisions.';
      setError(message);
      reportError("Couldn't apply capture review decisions.", e);
      return null;
    }
  }, [job, targetBranchId, userId, candidates, modelId, orgId, reload]);

  const searchTargetElements = useCallback(
    async (elementType: ElementType, query: string): Promise<{ elementId: UUID; name: string; parentName: string | null }[] | null> => {
      if (!targetBranchId) return null;
      if (targetHeadCacheRef.current?.branchId !== targetBranchId) {
        targetHeadCacheRef.current = { branchId: targetBranchId, promise: loadTargetBranchHead(supabase, modelId, targetBranchId) };
      }
      const { head } = await targetHeadCacheRef.current.promise;
      const trimmedQuery = query.trim().toLowerCase();
      const matches: { elementId: UUID; name: string; parentName: string | null }[] = [];
      for (const [elementId, element] of head.elements) {
        if (element.elementType !== elementType) continue;
        if (trimmedQuery !== '' && !element.name.toLowerCase().includes(trimmedQuery)) continue;
        const parent = element.parentId !== null ? head.elements.get(element.parentId) : undefined;
        matches.push({ elementId, name: element.name, parentName: parent?.name ?? null });
      }
      matches.sort((a, b) => a.name.localeCompare(b.name));
      return matches.slice(0, 20);
    },
    [modelId, targetBranchId],
  );

  return { status, error, job, candidates, changeBranches, mainElementById, mainRelationshipById, targetBranchId, setTargetBranchId, createTargetBranch, decide, decideMany, apply, searchTargetElements, reload };
}
