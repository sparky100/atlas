import { useId, useState } from 'react';
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
import { getDecisionOptionForBranch, getOptionApproachForBranch } from '../../db/decisionOptions';
import { listCatalogueSources } from '../../db/productCatalogue';
import styles from './OptionDraftCard.module.css';
import { optionDraftActions, optionDraftLabel, type DraftSystem, type OptionDraftAction } from './optionDraftActions';

/** At most this many linked elements and supporters are read, so the lookups stay small (CLAUDE.md rule 8). */
const MAX_IDS = 50;

/**
 * On an option change with no edits yet: offers the obvious first edits, read from what its decision
 * concerns. Nothing is saved here; each button opens the existing Retire panel (which asks what replaces
 * the system), the system's edit form, or the add-a-system box on Home, all on this change. Which ones follow
 * which option this is (see `optionDraftActions`). No AI.
 */
export function OptionDraftCard({ branch, mainHeadCommitId, orgSlug, modelSlug }: { branch: BranchRow; mainHeadCommitId: UUID | null; orgSlug: string; modelSlug: string }) {
  const productId = useId();
  // The product to replace the system with, typed by the person. Until they type, it is the product the option names (if any).
  const [typedProduct, setTypedProduct] = useState<string | null>(null);
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
        const concernedSystems: DraftSystem[] = [...linked.values()].filter((e) => (e.element_type === 'system' || e.element_type === 'container') && lifecycleStateOf(e, linked, now) === 'active').map((e) => ({ id: e.element_id, name: e.name, module: e.element_type === 'container' }));
        const capabilities = [...linked.values()].filter((e) => e.element_type === 'capability');
        const edges = await listSupportsEdgesForCapabilities(supabase, commitId, capabilities.map((c) => c.element_id).slice(0, 20));
        const supporterIds = [...new Set(edges.map((e) => e.from_element_id))].slice(0, MAX_IDS);
        const supporters = supporterIds.length > 0 ? await getElementsByIds(supabase, commitId, supporterIds) : new Map<UUID, ElementsHeadRow>();
        const supporterSystems: DraftSystem[] = [...supporters.values()].filter((e) => (e.element_type === 'system' || e.element_type === 'container') && lifecycleStateOf(e, supporters, now) === 'active').map((e) => ({ id: e.element_id, name: e.name, module: e.element_type === 'container' }));
        const approach = await getOptionApproachForBranch(supabase, branch.id);
        // A "Use <product>" option carries its product as a saved source: the replacement is that product.
        let product: string | null = null;
        if (approach === 'buy') {
          const option = await getDecisionOptionForBranch(supabase, decision.id, branch.id);
          const sources = option === null ? [] : (await listCatalogueSources(supabase, decision.id)).filter((r) => r.option_id === option.id);
          product = sources.length === 1 ? (sources[0]?.snapshot.product ?? null) : null;
        }
        return optionDraftActions(approach, concernedSystems, supporterSystems, capabilities.map((c) => c.name), product);
      } catch (e) {
        reportError("Couldn't read what this option's decision concerns.", e);
        throw e;
      }
    },
  });
  if (!data || data.length === 0) return null;
  // Only a bought product has a name to give; a custom build or an extension does not.
  const buys = data.filter((a) => a.kind === 'retire-and-replace' && a.custom !== true);
  const product = (typedProduct ?? buys[0]?.product ?? '').trim().slice(0, 200);
  const actions: OptionDraftAction[] = data.map((a) => (a.kind === 'retire-and-replace' && a.custom !== true && product !== '' ? { ...a, product } : a));
  const base = `/o/${orgSlug}/m/${modelSlug}`;
  const ref = refQueryParam({ kind: 'branch', branchId: branch.id }, false);
  return (
    <div data-testid="option-draft-card">
      <Text as="p" size="sm">
        Start with the obvious edit (suggested from what this decision concerns, no AI). You choose the details before anything is saved.
      </Text>
      {buys.length > 0 && (
        <div className={styles.field}>
          <label htmlFor={productId}>
            <Text as="span" size="sm" tone="muted">
              Product that replaces it (optional; name one that is not on the list if you like)
            </Text>
          </label>
          <input
            id={productId}
            type="text"
            className={styles.input}
            maxLength={200}
            value={typedProduct ?? buys[0]?.product ?? ''}
            onChange={(e) => {
              setTypedProduct(e.target.value);
            }}
            data-testid="option-draft-product"
          />
        </div>
      )}
      <div>
        {actions.map((action) => (
          <LinkButton
            key={`${action.kind}-${action.systemId ?? 'new'}`}
            to={action.systemId === null ? `${base}?${ref}&add=system` : `${base}/e/${action.systemId}?${ref}&action=${action.kind === 'extend' ? 'edit' : 'retire'}${action.kind !== 'extend' && action.custom ? '&sourcing=custom_build' : ''}${action.kind === 'retire-and-replace' && action.product ? `&sourcing=product&replacement=${encodeURIComponent(action.product)}` : ''}`}
            variant="secondary"
          >
            {optionDraftLabel(action)}
          </LinkButton>
        ))}
      </div>
    </div>
  );
}
