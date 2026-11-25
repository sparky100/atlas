import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { getDecisionForOption, listDecisionLinksForDecision } from '../../db/decisions';
import { getElementsByIds } from '../../db/elements';
import { refQueryParam } from '../../db/ref';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow } from '../../db/types';
import { lifecycleStateOf } from '../../engine/elementRead/fitAndExposure';
import { LinkButton } from '../components/Button/LinkButton';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { getOptionApproachForBranch } from '../../db/decisionOptions';
import { optionDraftActions, optionDraftLabel, type DraftSystem } from './optionDraftActions';

/** At most this many linked elements and supporters are read, so the lookups stay small (CLAUDE.md rule 8). */
const MAX_IDS = 50;

/**
 * On an option change with no edits yet: offers the obvious first edits, read from what its decision
 * concerns. Nothing is saved here; each button opens the existing Retire panel (which asks what replaces
 * the system), the system's edit form, or the add-a-system box on Home, all on this change. Which ones follow
 * which option this is (see `optionDraftActions`). No AI.
 */
export function OptionDraftCard({ branch, mainHeadCommitId, orgSlug, modelSlug }: { branch: BranchRow; mainHeadCommitId: UUID | null; orgSlug: string; modelSlug: string }) {
  const { data } = useQuery({
    queryKey: ['changes', 'optionDraft', branch.id, mainHeadCommitId],
    enabled: mainHeadCommitId !== null && branch.intent === 'explore',
    queryFn: async () => {
      try {
        const commitId = mainHeadCommitId;
        if (commitId === null) return null;
        const decision = await getDecisionForOption(supabase, branch.id);
        if (!decision) return null;
        const links = (await listDecisionLinksForDecision(supabase, decision.id)).filter((l) => l.linked_type === 'element').slice(0, MAX_IDS);
        const linked = links.length > 0 ? await getElementsByIds(supabase, commitId, links.map((l) => l.linked_id)) : new Map<UUID, ElementsHeadRow>();
        const now = new Date();
        const concernedSystems: DraftSystem[] = [...linked.values()].filter((e) => e.element_type === 'system' && lifecycleStateOf(e, linked, now) === 'active').map((e) => ({ id: e.element_id, name: e.name }));
        const capabilities = [...linked.values()].filter((e) => e.element_type === 'capability');
        const edges = await listSupportsEdgesForCapabilities(supabase, commitId, capabilities.map((c) => c.element_id).slice(0, 20));
        const supporterIds = [...new Set(edges.map((e) => e.from_element_id))].slice(0, MAX_IDS);
        const supporters = supporterIds.length > 0 ? await getElementsByIds(supabase, commitId, supporterIds) : new Map<UUID, ElementsHeadRow>();
        const supporterSystems: DraftSystem[] = [...supporters.values()].filter((e) => lifecycleStateOf(e, supporters, now) === 'active').map((e) => ({ id: e.element_id, name: e.name }));
        return optionDraftActions(await getOptionApproachForBranch(supabase, branch.id), concernedSystems, supporterSystems, capabilities.map((c) => c.name));
      } catch (e) {
        reportError("Couldn't read what this option's decision concerns.", e);
        throw e;
      }
    },
  });
  if (!data || data.length === 0) return null;
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const ref = refQueryParam({ kind: 'branch', branchId: branch.id }, false);
  return (
    <div data-testid="option-draft-card">
      <Text as="p" size="sm">
        Start with the obvious edit (suggested from what this decision concerns, no AI). You choose the details before anything is saved.
      </Text>
      <div>
        {data.map((action) => (
          <LinkButton
            key={`${action.kind}-${action.systemId ?? 'new'}`}
            to={action.systemId === null ? `${base}?${ref}&add=system` : `${base}/e/${action.systemId}?${ref}&action=${action.kind === 'extend' ? 'edit' : 'retire'}${action.kind !== 'extend' && action.custom ? '&sourcing=custom_build' : ''}`}
            variant="secondary"
          >
            {optionDraftLabel(action)}
          </LinkButton>
        ))}
      </div>
    </div>
  );
}
