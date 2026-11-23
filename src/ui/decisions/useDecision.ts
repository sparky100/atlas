import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getMainBranch, listBranchesByIds } from '../../db/branches';
import { getDecision, listDecisionArgumentsForDecision, listDecisionLinksForDecision } from '../../db/decisions';
import { getDecisionOptionForBranch, listDecisionOptions } from '../../db/decisionOptions';
import { getElementsByIds } from '../../db/elements';
import type { BranchRow, DecisionArgumentRow, DecisionLinkRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type DecisionPageStatus = 'loading' | 'idle' | 'not_found';

export interface DecisionPageData {
  decision: DecisionRow;
  links: DecisionLinkRow[];
  /** `linked_type: 'element'`/`'relationship'` links, resolved against main's current head — decisions are model-wide, never branch-scoped, so there is no other ref to resolve them against. Missing from the map only if the element/relationship has since been retracted past main's current head (the link row itself is never removed — SPEC §2's own append-only convention). */
  linkedElementsById: Map<UUID, ElementsHeadRow>;
  /** `linked_type: 'branch'` links (F3's own options mechanism, PR5) - the comparison and change views still use these. */
  linkedBranchesById: Map<UUID, BranchRow>;
  /** D1 stage 1 candidate identities, in display order. Existing branch options are backfilled; the branch is still the delivery object. */
  options: DecisionOptionRow[];
  /** Always empty until `atlas.choose_decision_option` (PR5) writes the chosen option's own reasons row - queried for real so the page renders an honest empty state, not a hardcoded one. */
  args: DecisionArgumentRow[];
}

export type DecisionPageState = { status: 'loading' } | { status: 'not_found' } | { status: 'error'; message: string } | ({ status: 'ready' } & DecisionPageData);

/**
 * Choose's own already-known result (`chooseDecisionOption`'s return)
 * applied directly to ready state — no fetch, no loading flash. Pure and
 * exported so it's unit-testable on its own (this repo's hooks aren't
 * rendered in tests — see `decisionComparisonKey.ts`'s own module
 * comment for why "does this ever produce `loading`" has to be proven
 * against the pure function, not the hook). A no-op before the first
 * load completes — nothing to patch yet, and a write can't happen before
 * then anyway (Choose needs a real option, which needs a loaded page).
 */
export function applyDecisionUpdate(state: DecisionPageState, decision: DecisionRow): DecisionPageState {
  return state.status === 'ready' ? { ...state, decision } : state;
}

/** "Add an option"'s own already-known branch/link, appended directly - no fetch, no loading flash. Its option row is read separately below because the database trigger, not the client, now creates it. Same reasoning and same no-op-before-ready stance as `applyDecisionUpdate`. */
export function applyNewOption(state: DecisionPageState, link: DecisionLinkRow, branch: BranchRow, option?: DecisionOptionRow): DecisionPageState {
  if (state.status !== 'ready') return state;
  const linkedBranchesById = new Map(state.linkedBranchesById);
  linkedBranchesById.set(branch.id, branch);
  const next = { ...state, links: [...state.links, link], linkedBranchesById };
  return option === undefined ? next : applyDecisionOption(next, option);
}

function optionOrder(a: DecisionOptionRow, b: DecisionOptionRow): number {
  return a.position - b.position || a.created_at.localeCompare(b.created_at);
}

/** Adds or replaces one candidate row; used after the add-option trigger has written the identity. */
export function applyDecisionOption(state: DecisionPageState, option: DecisionOptionRow): DecisionPageState {
  if (state.status !== 'ready') return state;
  const exists = state.options.some((o) => o.id === option.id);
  const options = (exists ? state.options.map((o) => (o.id === option.id ? option : o)) : [...state.options, option]).sort(optionOrder);
  return { ...state, options };
}

/** A concern added on the decision page — its link and the element it points at, appended directly; same no-op-before-ready stance as `applyNewOption`. */
export function applyNewConcern(state: DecisionPageState, link: DecisionLinkRow, element: ElementsHeadRow): DecisionPageState {
  if (state.status !== 'ready') return state;
  const linkedElementsById = new Map(state.linkedElementsById);
  linkedElementsById.set(element.element_id, element);
  return { ...state, links: [...state.links, link], linkedElementsById };
}

/**
 * F6.2 (fast rating saves): `decision_option_ratings` is deliberately
 * *not* fetched here — `useDecisionRatings.ts` owns that data as its own
 * lifecycle now, so a rating save patches its own local state instead of
 * calling this hook's `reload()` and re-running every query below for a
 * change that only ever touched one table. Fetching ratings a second
 * time here would just be a redundant initial-load query with nothing to
 * show for it.
 */
export async function loadDecisionPageData(modelId: UUID, decisionId: UUID): Promise<DecisionPageState> {
  const decision = await getDecision(supabase, decisionId);
  if (!decision) return { status: 'not_found' };

  const [links, args, main, options] = await Promise.all([
    listDecisionLinksForDecision(supabase, decisionId),
    listDecisionArgumentsForDecision(supabase, decisionId),
    getMainBranch(supabase, modelId),
    listDecisionOptions(supabase, decisionId),
  ]);

  const elementLinkIds = links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship').map((l) => l.linked_id);
  const branchLinkIds = links.filter((l) => l.linked_type === 'branch').map((l) => l.linked_id);

  const [linkedElements, linkedBranches] = await Promise.all([
    main?.head_commit_id && elementLinkIds.length > 0 ? getElementsByIds(supabase, main.head_commit_id, elementLinkIds) : Promise.resolve(new Map<UUID, ElementsHeadRow>()),
    branchLinkIds.length > 0 ? listBranchesByIds(supabase, branchLinkIds) : Promise.resolve([]),
  ]);

  return { status: 'ready', decision, links, linkedElementsById: linkedElements, linkedBranchesById: new Map(linkedBranches.map((b) => [b.id, b])), options, args };
}

export interface UseDecisionResult {
  state: DecisionPageState;
  /** A full manual reload — re-fetches everything and does show the page-level `loading` state, same as the first load. Not called by Add-an-option/Choose any more (see `applyNewOption`/`applyDecisionUpdate`/`refreshOptionsAndArguments` below) — kept as a general-purpose escape hatch, e.g. for a future error retry. */
  reload: () => void;
  /** Choose's own decision-row patch — see `applyDecisionUpdate`'s own doc comment. */
  applyDecisionUpdate: (decision: DecisionRow) => void;
  /** Add-an-option's own link+branch patch — see `applyNewOption`'s own doc comment. */
  applyNewOption: (link: DecisionLinkRow, branch: BranchRow) => void;
  /** A newly added concern's link and element — see `applyNewConcern`'s own doc comment. */
  applyNewConcern: (link: DecisionLinkRow, element: ElementsHeadRow) => void;
  /**
   * Choose's own "refresh only the affected data": re-reads just the
   * branch-linked options' rows (every other draft option gets cancelled
   * by `atlas.choose_decision_option` itself, and the chosen one's own
   * intent flips — neither comes back in that RPC's own return) and the
   * arguments list (the RPC's own new `decision_arguments` row) — never
   * `links`/`main`/`linkedElementsById`, which Choose never touches. No
   * loading flash, same as the two `apply*` patches above.
   */
  refreshOptionsAndArguments: () => Promise<void>;
}

/** A single decision's own page (prompt pack F3 PR4) — mirrors `useChange.ts`'s load/reload shape. No edit action yet (PR4's own scope is "plain create/list/detail"); PR5 adds "Add an option"/"Choose", PR6 adds "Start a decision"/"why is this here". */
export function useDecision(modelId: UUID, decisionId: UUID): UseDecisionResult {
  const [state, setState] = useState<DecisionPageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    // `DecisionPage.tsx` calls this hook unconditionally (rules of hooks)
    // before its own org/model lookup has resolved, passing `''` for
    // `modelId` on that first render — `getMainBranch`'s own `assertRealId`
    // guard would throw immediately on that placeholder, posting a real
    // (but spurious) error banner a moment before the second, real fetch
    // quietly succeeds and renders the page underneath it. Staying in
    // `loading` until both ids are real avoids ever attempting that first,
    // doomed fetch at all.
    if (!modelId || !decisionId) return;
    loadDecisionPageData(modelId, decisionId)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load this decision.", e);
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this decision.' });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, decisionId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const applyDecisionUpdateCallback = useCallback((decision: DecisionRow) => {
    setState((prev) => applyDecisionUpdate(prev, decision));
  }, []);

  const applyNewOptionCallback = useCallback((link: DecisionLinkRow, branch: BranchRow) => {
    setState((prev) => applyNewOption(prev, link, branch));
    // The branch link's database trigger creates the candidate row. Read back
    // just that row; the branch/link patch above already rendered the change.
    void getDecisionOptionForBranch(supabase, link.decision_id, branch.id)
      .then((option) => {
        if (option !== null) setState((prev) => applyDecisionOption(prev, option));
      })
      .catch((e: unknown) => {
        reportError('Could not load the option that was just added.', e);
      });
  }, []);

  const applyNewConcernCallback = useCallback((link: DecisionLinkRow, element: ElementsHeadRow) => {
    setState((prev) => applyNewConcern(prev, link, element));
  }, []);

  const refreshOptionsAndArguments = useCallback(async () => {
    if (state.status !== 'ready') return;
    const branchLinkIds = state.links.filter((l) => l.linked_type === 'branch').map((l) => l.linked_id);
    const [branches, args, options] = await Promise.all([
      listBranchesByIds(supabase, branchLinkIds),
      listDecisionArgumentsForDecision(supabase, decisionId),
      listDecisionOptions(supabase, decisionId),
    ]);
    setState((prev) => (prev.status === 'ready' ? { ...prev, linkedBranchesById: new Map(branches.map((b) => [b.id, b])), options, args } : prev));
  }, [state, decisionId]);

  return { state, reload, applyDecisionUpdate: applyDecisionUpdateCallback, applyNewOption: applyNewOptionCallback, applyNewConcern: applyNewConcernCallback, refreshOptionsAndArguments };
}
