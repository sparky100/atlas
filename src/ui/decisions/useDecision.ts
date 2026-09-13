import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { getMainBranch, listBranchesByIds } from '../../db/branches';
import { getDecision, listDecisionArgumentsForDecision, listDecisionLinksForDecision } from '../../db/decisions';
import { getElementsByIds } from '../../db/elements';
import type { BranchRow, DecisionArgumentRow, DecisionLinkRow, DecisionRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type DecisionPageStatus = 'loading' | 'idle' | 'not_found';

export interface DecisionPageData {
  decision: DecisionRow;
  links: DecisionLinkRow[];
  /** `linked_type: 'element'`/`'relationship'` links, resolved against main's current head — decisions are model-wide, never branch-scoped, so there is no other ref to resolve them against. Missing from the map only if the element/relationship has since been retracted past main's current head (the link row itself is never removed — SPEC §2's own append-only convention). */
  linkedElementsById: Map<UUID, ElementsHeadRow>;
  /** `linked_type: 'branch'` links (F3's own options mechanism, PR5) — resolved eagerly here too, even though no option exists yet this PR, so the detail page needs no separate fetch once PR5 adds them. */
  linkedBranchesById: Map<UUID, BranchRow>;
  /** Always empty until `atlas.choose_decision_option` (PR5) writes the chosen option's own reasons row — queried for real so the page renders an honest empty state, not a hardcoded one. */
  args: DecisionArgumentRow[];
}

export type DecisionPageState = { status: 'loading' } | { status: 'not_found' } | { status: 'error'; message: string } | ({ status: 'ready' } & DecisionPageData);

async function loadDecisionPageData(modelId: UUID, decisionId: UUID): Promise<DecisionPageState> {
  const decision = await getDecision(supabase, decisionId);
  if (!decision) return { status: 'not_found' };

  const [links, args, main] = await Promise.all([listDecisionLinksForDecision(supabase, decisionId), listDecisionArgumentsForDecision(supabase, decisionId), getMainBranch(supabase, modelId)]);

  const elementLinkIds = links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship').map((l) => l.linked_id);
  const branchLinkIds = links.filter((l) => l.linked_type === 'branch').map((l) => l.linked_id);

  const [linkedElements, linkedBranches] = await Promise.all([
    main?.head_commit_id && elementLinkIds.length > 0 ? getElementsByIds(supabase, main.head_commit_id, elementLinkIds) : Promise.resolve(new Map<UUID, ElementsHeadRow>()),
    branchLinkIds.length > 0 ? listBranchesByIds(supabase, branchLinkIds) : Promise.resolve([]),
  ]);

  return { status: 'ready', decision, links, linkedElementsById: linkedElements, linkedBranchesById: new Map(linkedBranches.map((b) => [b.id, b])), args };
}

export interface UseDecisionResult {
  state: DecisionPageState;
  reload: () => void;
}

/** A single decision's own page (prompt pack F3 PR4) — mirrors `useChange.ts`'s load/reload shape. No edit action yet (PR4's own scope is "plain create/list/detail"); PR5 adds "Add an option"/"Choose", PR6 adds "Start a decision"/"why is this here". */
export function useDecision(modelId: UUID, decisionId: UUID): UseDecisionResult {
  const [state, setState] = useState<DecisionPageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
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

  return { state, reload };
}
