import { Loading } from '../components/Loading/Loading';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { suggestOptions } from './optionSuggestions';
import { findingLabel } from './findingLabels';
import { aiMarkLine } from './aiMarks';
import { useEstateSuggestions } from './useEstateSuggestions';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import type { BranchRow, DecisionLinkRow, DecisionOptionRow, DecisionRow, MemberRole } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';
import { profileLabel } from '../comments/profileLabel';
import { chooseNote } from './chooseNote';
import { askToChooseComment, decisionNextStep } from './decisionNextStep';
import { DecisionNextStepCard } from './DecisionNextStepCard';
import { createComment } from '../../db/comments';
import { canAddDecisionConcern, canCancelDecision, canChooseDecisionOption, canCreateChangeBranch, canEditDecision, canRateDecisionOption } from '../orgs/useMembership';
import { useMembers } from '../orgs/useMembers';
import { ownerNames } from '../orgs/ownerNames';
import { reviewerAvailability } from './reviewerAvailability';
import { SecondOpinion } from './SecondOpinion';
import { KeptQuestions } from './KeptQuestions';
import { CapabilityProducts } from '../elements/CapabilityProducts';
import { optionKindOf } from '../changes/optionDraftActions';
import { attributesRecord } from '../elements/attributesRecord';
import type { AlsoAffectedElement } from './alsoAffected';
import { DecisionBaselineCard } from './DecisionBaselineCard';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { DecisionCriteriaGrid, type DecisionCriteriaOption } from './DecisionCriteriaGrid';
import { DecisionGoLive } from './DecisionGoLive';
import { DecisionPacks } from './DecisionPacks';
import { DecisionLinkPicker } from './DecisionLinkPicker';
import { DecisionPrinciplesPanel } from '../principles/DecisionPrinciplesPanel';
import { adrPrincipleItems } from '../principles/decisionPrinciples';
import { useDecisionPrinciples } from '../principles/useDecisionPrinciples';
import { goalTitlesServedBy } from '../goals/goalModel';
import { useModelGoals } from '../goals/useModelGoals';
import { canLinkDecisionPrinciples } from '../orgs/roleGates';
import { decisionStatusLabel, decisionStatusMeaning, decisionStatusTone } from './decisionStatus';
import { cancelDecision, createDecisionLink, updateDecision } from '../../db/decisions';
import { getElementsByIds } from '../../db/elements';
import type { ElementsHeadRow } from '../../contracts/rows';
import { setDecisionProject } from '../../db/projects';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { ProjectAssignment } from '../projects/ProjectAssignment';
import { supabase } from '../supabaseClient';
import { listDecisionAgentNotes } from '../../db/decisionAgentNotes';
import { buildDecisionAdrExportInput, decisionConcernIds } from './decisionAdrInput';
import { exportDecisionAsAdrMarkdown } from './exportDecisionAsAdr';
import type { DecisionPageState } from './useDecision';
import { useDecisionComparison, type DecisionComparisonOption } from './useDecisionComparison';
import { useDecisionOptions } from './useDecisionOptions';
import { usePendingOptions } from './usePendingOptions';
import { optionProvenance, optionRowProvenance } from './optionProvenance';
import { useDecisionRatings } from './useDecisionRatings';
import { useOptionSources } from './useOptionSources';
import type { OptionCatalogueSource, OptionSource } from '../../contracts/optionSource';
import { groupWhatChangesRows, type WhatChangesRow } from './whatChangesRows';
import styles from './DecisionView.module.css';
import { useCompactDecisionLayout } from './useCompactDecisionLayout';
import { WebResearchDialog } from './WebResearchDialog';
import { useDecisionCapabilityConcerns } from './useDecisionCapabilityConcerns';
import { addResearchOption } from './addResearchOption';
import { listEarlierResearchUrls } from '../../db/webResearch';
import { researchOptionTitle } from './researchOptionText';
import { mergeKnownCatalogueProducts, type KnownCatalogueProduct } from './researchCatalogueMatches';
import { useDecisionCatalogueProducts } from './useDecisionCatalogueProducts';

export interface DecisionViewProps {
  modelId: UUID;
  decisionId: UUID;
  orgId: UUID;
  orgSlug: string;
  modelSlug: string;
  role: MemberRole | null;
  assistantEnabled: boolean;
  agentsEnabled: boolean;
  keySet: boolean;
  /** The organisation's guarded web research switch (default off). */
  webSearchEnabled: boolean;
  shareCost: boolean;
  /** Lifted from `DecisionPage.tsx`'s own `useDecision` call, not fetched again here — the two used to each run their own independent copy of the same fetch (one for this view, one `DecisionPage.tsx` only ever read `.title` from), so a transient failure of either one alone could post the "Couldn't load this decision" banner even while the other succeeded and rendered full content underneath it (found in a walkthrough, issue-reported). One fetch, shared. */
  state: DecisionPageState;
  /** `useDecision.ts`'s own patches — see that file's doc comments. Passed straight through to `useDecisionOptions` so Add-an-option/Choose never trigger this page's own full `reload()`/loading flash any more. */
  applyCreatedOption: (option: DecisionOptionRow) => void;
  applyNewOption: (link: DecisionLinkRow, branch: BranchRow) => void;
  applyNewConcern: (link: DecisionLinkRow, element: ElementsHeadRow) => void;
  applyDecisionUpdate: (decision: DecisionRow) => void;
  refreshOptionsAndArguments: () => Promise<void>;
}

/**
 * A single decision's own page (prompt pack F3). PR4 built context/owner/
 * needed-by, its links, and comments; PR5 added "Add an option" (a fresh
 * `explore`-intent branch, linked), the comparison table
 * (`compareOptions.ts` — each option's own folded state re-run through
 * the existing capability-map metrics and boundary-crossing finding,
 * diffed against main), and "Choose" (`atlas.choose_decision_option` in
 * one call). PR6 adds "Copy as ADR markdown" (`exportDecisionAsAdr.ts` —
 * a pure string-template builder, copied to the clipboard the same way
 * `ElementHeader.tsx`'s own "Copy element ID" already does, since nothing
 * in this app has ever offered a file download to invent a second
 * mechanism for). "Start a decision" from a health finding and "why is
 * this here" (an element's own linked decisions) are also PR6, but live on
 * `DecisionsView.tsx`/`ElementDecisionsSection.tsx` respectively, not here.
 */
export function DecisionView({ modelId, decisionId, orgId, orgSlug, modelSlug, role, assistantEnabled, agentsEnabled, keySet, webSearchEnabled, shareCost, state, applyCreatedOption, applyNewOption, applyNewConcern, applyDecisionUpdate, refreshOptionsAndArguments }: DecisionViewProps) {
  const { userId } = useAuth();
  const compact = useCompactDecisionLayout();
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  const optionsState = useDecisionOptions(applyCreatedOption, applyDecisionUpdate, refreshOptionsAndArguments);
  // Options kept from the Designer's suggestions are saved here as the page opens (journey proposal step 2).
  const pendingOptions = usePendingOptions({ orgId, modelId, decisionId, userId, projectId: state.status === 'ready' ? state.decision.project_id : null, canAdd: state.status === 'ready' && state.decision.status === 'proposed' && canCreateChangeBranch(role), applyNewOption });
  const navigate = useNavigate();
  // `?edit=1` (from "Start decision" on a project) opens the decision's own edit form straight away.
  const [searchParams] = useSearchParams();
  const startEditing = searchParams.get('edit') === '1';
  const { setRef } = useSelectedRef();
  // Lifted up from `DecisionCriteriaGrid.tsx` (decision-side-completion
  // item 6) — the ADR export below needs every option's own ratings too,
  // and a second independent `useDecisionRatings` instance there would
  // mean two separate fetches/polling loops for the same table.
  const ratingsState = useDecisionRatings(modelId, decisionId);
  const principlesState = useDecisionPrinciples(modelId, decisionId, userId);
  const principlesFollowed = principlesState.links.filter((l) => l.stance === 'follows').length;
  const principlesDeparted = principlesState.links.filter((l) => l.stance === 'departs').length;
  const { data: keptNotes } = useQuery({ queryKey: ['decisionAgentNotes', decisionId], queryFn: () => listDecisionAgentNotes(supabase, decisionId) });
  const modelGoals = useModelGoals(modelId);
  // Catalogue citations saved with each option, in the saved snapshot. The
  // pack, the grid and (later) the option page all read this same shape.
  const optionSources = useOptionSources(decisionId);
  const sourcesByBranch = new Map<string, OptionSource[]>();
  const sourcesByOption = new Map<string, OptionSource[]>();
  for (const source of optionSources.data ?? []) {
    const branchList = sourcesByBranch.get(source.branchId) ?? [];
    branchList.push(source);
    sourcesByBranch.set(source.branchId, branchList);
    if (source.optionId != null) {
      const optionList = sourcesByOption.get(source.optionId) ?? [];
      optionList.push(source);
      sourcesByOption.set(source.optionId, optionList);
    }
  }

  const [addingOption, setAddingOption] = useState(false);
  const [researchTarget, setResearchTarget] = useState<{ branchId: UUID; label: string } | null>(null);
  const [optionTitle, setOptionTitle] = useState('');
  const [choosing, setChoosing] = useState<{ optionId: UUID | null; branchId: UUID | null } | null>(null);
  const [reasons, setReasons] = useState('');
  const [reconsiderIf, setReconsiderIf] = useState('');
  const [reviewBy, setReviewBy] = useState('');
  const [adrCopied, setAdrCopied] = useState(false);
  const [whatChangesExpanded, setWhatChangesExpanded] = useState(false);
  const [askedNames, setAskedNames] = useState<string[] | null>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [commentsKey, setCommentsKey] = useState(0);
  useEffect(() => {
    if (choosing !== null) requestAnimationFrame(() => document.getElementById('decision-confirm-choice')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [choosing]);

  // Only read the decision's egress record while the Researcher is open: it
  // costs nothing on an ordinary page load and shows earlier pages as reuse.
  const { data: earlierResearchUrls = [] } = useQuery({
    queryKey: ['webResearchRequests', decisionId],
    queryFn: () => listEarlierResearchUrls(supabase, decisionId),
    enabled: researchTarget !== null,
  });

  // Every hook above must run unconditionally (rules of hooks) — the
  // comparison hook too, even before `state` has resolved to `ready`;
  // it degrades to its own `'empty'` state on an empty/not-yet-loaded input.
  const readyState = state.status === 'ready' ? state : null;
  const elementLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship') : [];
  const branchLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'branch') : [];
  const optionByBranchId = new Map<UUID, DecisionOptionRow>();
  for (const option of readyState?.options ?? []) {
    if (option.branch_id !== null) optionByBranchId.set(option.branch_id, option);
  }
  const baselineOption = readyState === null
    ? undefined
    : readyState.options.find((option) => readyState.decision.baseline_option_id !== null
      ? option.id === readyState.decision.baseline_option_id
      : option.branch_id !== null && option.branch_id === readyState.decision.baseline_branch_id);
  const baselineBranchId = baselineOption?.branch_id ?? readyState?.decision.baseline_branch_id ?? null;
  // Products belong beside a replacement decision, not on the capability page:
  // only when an option is a replace/build one, and only for the capabilities
  // this decision concerns.
  const capabilityConcerns = elementLinks.flatMap((link) => {
    const element = readyState?.linkedElementsById.get(link.linked_id);
    return element?.element_type === 'capability' ? [element] : [];
  });
  const readyOptions = readyState?.options ?? [];
  const hasReplaceOrBuildOption = readyOptions.length > 0
    ? readyOptions.some((option) => {
        const kind = optionKindOf(option.title);
        return kind === 'replace' || kind === 'build';
      })
    : branchLinks.some((link) => {
        const branch = readyState?.linkedBranchesById.get(link.linked_id);
        const kind = optionKindOf(branch?.title ?? branch?.name ?? '');
        return kind === 'replace' || kind === 'build';
      });
  const concernedCapabilityIds = readyState ? elementLinks.map((l) => l.linked_id).filter((id) => readyState.linkedElementsById.get(id)?.element_type === 'capability') : [];
  // F6.3 (Part B) rule 5: a system/container concern gets its own outcome
  // row (unchanged/retired/replaced by X) alongside a capability concern's
  // four metric rows — a distinct id list, since the two never share a
  // row shape.
  const otherConcernElementIds = readyState ? elementLinks.map((l) => l.linked_id).filter((id) => { const t = readyState.linkedElementsById.get(id)?.element_type; return t === 'system' || t === 'container'; }) : [];
  const comparisonOptions: DecisionComparisonOption[] = readyState
    ? branchLinks
        .map((l) => readyState.linkedBranchesById.get(l.linked_id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined)
        // The "Stay as we are" baseline records no change, so it is not a column of "What changes": the Current column already is staying as we are.
        .filter((b) => b.id !== baselineBranchId)
        .map((b) => ({ branchId: b.id, baseCommitId: b.base_commit_id, headCommitId: b.head_commit_id, label: optionByBranchId.get(b.id)?.title ?? intentHeaderLine(b) }))
    : [];
  const estateSupporters = useEstateSuggestions(main?.head_commit_id ?? null, concernedCapabilityIds);
  const comparison = useDecisionComparison(modelId, main?.head_commit_id ?? null, concernedCapabilityIds, otherConcernElementIds, comparisonOptions);
  // The Researcher's safe query chips: capabilities linked to the decision
  // directly, plus those reached through a linked system's `supports` edges.
  const concernedCapabilities = useDecisionCapabilityConcerns({
    commitId: main?.head_commit_id ?? null,
    links: readyState?.links ?? [],
    linkedElementsById: readyState?.linkedElementsById ?? new Map(),
    enabled: researchTarget !== null,
  });
  // Reviewed catalogue products already cited on this decision, used only to
  // mark a web page as "looks like the same product", never to invent a match.
  const savedCatalogueProducts: KnownCatalogueProduct[] = (() => {
    const byProduct = new Map<string, KnownCatalogueProduct>();
    for (const source of optionSources.data ?? []) {
      if (source.kind !== 'catalogue') continue;
      const key = `${source.vendor}\u0000${source.product}`;
      const urls = source.claims.map((claim) => claim.sourceUrl);
      const existing = byProduct.get(key);
      byProduct.set(key, existing === undefined
        ? { product: source.product, vendor: source.vendor, sourceUrls: urls }
        : { ...existing, sourceUrls: [...new Set([...existing.sourceUrls, ...urls])] });
    }
    return [...byProduct.values()];
  })();
  // Products the current published catalogue holds for the decision's direct
  // capability concerns, so a returned page can be recognised even before any
  // option has cited that product.
  const currentCatalogueProducts = useDecisionCatalogueProducts({
    enabled: researchTarget !== null,
    modelId,
    links: readyState?.links ?? [],
    linkedElementsById: readyState?.linkedElementsById ?? new Map(),
  });
  const knownCatalogueProducts = mergeKnownCatalogueProducts(savedCatalogueProducts, currentCatalogueProducts);

  // Choosing or cancelling in place changes how many decisions are proposed — the Decisions nav badge re-reads.
  const queryClient = useQueryClient();
  const decisionStatus = state.status === 'ready' ? state.decision.status : null;
  useEffect(() => {
    if (decisionStatus !== null) void queryClient.invalidateQueries({ queryKey: queryKeys.proposedDecisionCount(modelId) });
  }, [decisionStatus, modelId, queryClient]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'not_found') return <Text as="p">No decision found for this id.</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const { decision, links, linkedElementsById, linkedBranchesById, options, args } = state;
  const canAddOption = canCreateChangeBranch(role) && decision.status === 'proposed';
  const canResearch = canAddOption && webSearchEnabled && assistantEnabled && agentsEnabled && keySet;
  // Product and vendor names are safe context only when they are already
  // structured sources on the option, never parsed from its free-text summary.
  const reviewedNamesFor = (targetBranchId: UUID): { productNames: string[]; vendorNames: string[] } => {
    const sources = (sourcesByBranch.get(targetBranchId) ?? []).filter((source): source is OptionCatalogueSource => source.kind === 'catalogue');
    return {
      productNames: [...new Set(sources.map((source) => source.product))],
      vendorNames: [...new Set(sources.map((source) => source.vendor))],
    };
  };
  const canChoose = canChooseDecisionOption(role) && decision.status === 'proposed';
  const canRate = canRateDecisionOption(role, decision);
  const chosenBranch = decision.branch_id !== null ? linkedBranchesById.get(decision.branch_id) : undefined;
  const chosenOption = decision.branch_id !== null ? optionByBranchId.get(decision.branch_id) : undefined;
  // A candidate with no branch is still an option; only the baseline is
  // excluded from the comparison columns (the Current column covers it).
  const scoredOptions = options.filter((o) => o.id !== baselineOption?.id && (baselineBranchId === null || o.branch_id !== baselineBranchId));
  const secondOpinion = reviewerAvailability({ role, status: decision.status, optionCount: scoredOptions.length, assistantEnabled, agentsEnabled, keySet, ownerNames: ownerNames(members) });
  const canEditBaseline = canAddOption && canEditDecision(role, decision, userId);
  const baselineBranch = baselineBranchId !== null ? linkedBranchesById.get(baselineBranchId) : undefined;
  const approvers = members.filter((m) => m.member.role === 'owner' || m.member.role === 'architect');
  const ratedOptionIds = new Set<UUID>();
  for (const rating of ratingsState.ratings) {
    if (rating.option_id != null) {
      ratedOptionIds.add(rating.option_id);
    } else if (rating.branch_id !== null) {
      const option = optionByBranchId.get(rating.branch_id);
      if (option !== undefined) ratedOptionIds.add(option.id);
    }
  }
  const nextStep = decisionNextStep({
    status: decision.status,
    optionCount: scoredOptions.length,
    ratedOptionCount: scoredOptions.filter((o) => ratedOptionIds.has(o.id)).length,
    canAddOption,
    canChoose,
    chosenTitle: chosenOption?.title ?? (chosenBranch ? (chosenBranch.title ?? chosenBranch.name) : null),
    chosenIsBaseline: chosenOption?.id === baselineOption?.id || (decision.branch_id !== null && decision.branch_id === baselineBranchId),
  });

  function onNextStepAction() {
    if (!nextStep) return;
    if (nextStep.action === 'open-delivery') {
      if (decision.branch_id !== null) void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${decision.branch_id}`);
      return;
    }
    if (nextStep.action === 'compare' || nextStep.action === 'choose') {
      document.getElementById(nextStep.action === 'choose' && comparisonOptions.length > 0 ? 'decision-effects' : 'decision-compare')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (nextStep.action === 'ask-to-choose' && userId !== null) {
      setAskBusy(true);
      setAskError(null);
      const handles = approvers.map((m) => m.profile?.handle).filter((h): h is string => h !== undefined && h !== '');
      void createComment(supabase, { id: crypto.randomUUID(), orgId, modelId, anchorType: 'decision', anchorId: decisionId, body: askToChooseComment(handles, decision.title), authorId: userId })
        .then(() => {
          setAskedNames(approvers.map((m) => profileLabel(m.profile)));
          setCommentsKey((k) => k + 1);
        })
        .catch((e: unknown) => {
          setAskError("Couldn't send the request. Try again.");
          reportError("Couldn't ask an owner or architect to choose.", e);
        })
        .finally(() => {
          setAskBusy(false);
        });
    }
  }

  function workOnOption(optionId: UUID) {
    void optionsState.workOnOption(optionId).then((branch) => {
      if (branch === null) return;
      setRef({ kind: 'branch', branchId: branch.id });
      void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`);
    });
  }

  // Prompt pack F3 PR6's "Export as ADR markdown" - assembled from data
  // this page has already loaded (no second round trip).
  const ownerName = profileLabel(members.find((m) => m.member.user_id === decision.owner_id)?.profile);

  // Decision-side-completion item 6: "Copy as ADR markdown" also carries
  // the decision's own declared concerns, each option's own ratings/notes
  // (`ratingsState.ratings`, lifted up above so this doesn't need a second
  // fetch), and the What-changes table's own evidence — only the rows it
  // renders visible, never the collapsed "unchanged" group, matching the
  // table's own display exactly. Assembled by `decisionAdrInput.ts`, which
  // the project pack (F13 step 2) shares.
  function buildAdrMarkdown(): string {
    return exportDecisionAsAdrMarkdown(
      buildDecisionAdrExportInput({
        decision,
        links,
        linkedElementsById,
        linkedBranchesById,
        options,
        args,
        ratings: ratingsState.ratings,
        principles: adrPrincipleItems(principlesState.principles, principlesState.links),
        goalsServed: modelGoals ? goalTitlesServedBy(decisionConcernIds(links, linkedElementsById).capabilityIds, modelGoals.goals.filter((g) => g.status === 'active'), modelGoals.links) : [],
        whatChangesRows: comparison.status === 'ready' ? groupWhatChangesRows(comparison.whatChangesRows).visible : [],
        keptQuestions: keptNotes ?? [],
        sourcesByOption,
        sourcesByBranch,
        ownerName,
      }),
    );
  }

  async function copyAdrMarkdown() {
    const markdown = buildAdrMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      setAdrCopied(true);
      setTimeout(() => {
        setAdrCopied(false);
      }, 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // not worth surfacing as an error for a copy-to-clipboard nicety,
      // same call `ElementHeader.tsx`'s own "Copy element ID" makes.
    }
  }

  return (
    <div>
      <div className={styles.meta}>
        <div className={styles.statusBar} data-testid="decision-status">
          <Chip tone={decisionStatusTone(decision.status)}>{decisionStatusLabel(decision.status)}</Chip>
          <Text as="span" size="md">
            {decisionStatusMeaning(decision.status)}
          </Text>
        </div>
        {decision.needed_by !== null && (
          <Text as="span" tone="muted" size="sm">
            Needed by: {decision.needed_by}
          </Text>
        )}
        {decision.lens_map_url !== null && (
          <a href={decision.lens_map_url} target="_blank" rel="noreferrer">
            <Text as="span" size="sm">
              Lens map →
            </Text>
          </a>
        )}
        <Button variant="ghost" onClick={() => void copyAdrMarkdown()}>
          {adrCopied ? 'Copied' : 'Copy as ADR markdown'}
        </Button>
      </div>
      {/* F10 step 4 (ADR-024 P1): moving a proposed decision moves its draft options with it. */}
      <ProjectAssignment
        modelId={modelId}
        orgSlug={orgSlug}
        modelSlug={modelSlug}
        currentProjectId={decision.project_id}
        canMove={decision.status === 'proposed' && (decision.created_by === userId || role === 'owner' || role === 'architect')}
        onMove={async (projectId) => {
          const updated = await setDecisionProject(supabase, decision.id, projectId);
          applyDecisionUpdate(updated);
          await refreshOptionsAndArguments();
        }}
      />

      {canEditDecision(role, decision, userId) && (
        <DecisionEdit
          decision={decision}
          members={members.map((m) => ({ id: m.member.user_id, label: profileLabel(m.profile) }))}
          onSaved={applyDecisionUpdate}
          startOpen={startEditing}
        />
      )}
      <DecisionCancel
        decision={decision}
        canCancel={canCancelDecision(role, decision, userId)}
        cancelledByName={decision.decided_by !== null ? profileLabel(members.find((m) => m.member.user_id === decision.decided_by)?.profile) : null}
        onCancelled={async (updated) => {
          applyDecisionUpdate(updated);
          // Its draft options were cancelled with it.
          await refreshOptionsAndArguments();
        }}
      />
      <section className={styles.context} aria-label="Decision details">
        <Text as="h2" size="lg">Decision details</Text>
        <div className={styles.field}>
          <Text as="p" tone={decision.statement ? 'default' : 'muted'}>
            {decision.statement || 'No context recorded.'}
          </Text>
          {aiMarkLine(decision) !== null && (
            <div data-testid="decision-ai-mark">
              <Text as="p" tone="muted" size="sm">
                AI helped with this: {aiMarkLine(decision)}
              </Text>
            </div>
          )}
          {findingLabel(decision.source_finding_key) !== null && (
            <div data-testid="decision-source-finding">
<Text as="p" tone="muted" size="sm">
              Started from a health finding: {findingLabel(decision.source_finding_key)}.
            </Text>
</div>
          )}
        </div>
      </section>

      {decision.status === 'accepted' && (
        <Panel>
          <Text as="h2" size="lg">
            What we chose, why, and what would make us reconsider
          </Text>
          <div className={styles.field}>
            <Text as="h3" size="sm" tone="muted">
              What we chose
            </Text>
            <Text as="p">{chosenOption?.title ?? (chosenBranch !== undefined ? (chosenBranch.title ?? chosenBranch.name) : 'An option that is no longer linked to this decision.')}</Text>
            {decision.decided_at !== null && (
              <Text as="p" size="sm" tone="muted">
                Decided {decision.decided_at.slice(0, 10)}
              </Text>
            )}
          </div>
          <div className={styles.field}>
            <Text as="h3" size="sm" tone="muted">
              Why
            </Text>
            <Text as="p" tone={args.some((a) => a.stance === 'for') ? 'default' : 'muted'}>
              {args.find((a) => a.stance === 'for')?.body ?? 'No reasons recorded.'}
            </Text>
          </div>
          <div className={styles.field}>
            <Text as="h3" size="sm" tone="muted">
              What would make us reconsider
            </Text>
            <Text as="p" tone={decision.reconsider_if ? 'default' : 'muted'}>
              {decision.reconsider_if ?? 'Nothing was recorded when this was chosen.'}
            </Text>
            {decision.review_by !== null && (
              <Text as="p" size="sm" tone="muted">
                To be looked at again by {decision.review_by}
              </Text>
            )}
          </div>
        </Panel>
      )}

      <Panel>
        <CollapsibleSection title="Concerns" meta={`(${String(elementLinks.length)})`} defaultOpen={elementLinks.length > 0}>
        {elementLinks.length === 0 ? null : (
          <ul className={styles.linkList}>
            {elementLinks.map((link) => {
              const element = linkedElementsById.get(link.linked_id);
              return (
                <li key={link.linked_id} className={styles.linkRow}>
                  {element ? (
                    <>
                      <ElementTypeGlyph type={element.element_type} />
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${element.element_id}`}>
                        <Text as="span">{element.name}</Text>
                      </Link>
                    </>
                  ) : (
                    <Text as="span" tone="muted" size="sm">
                      A linked element that no longer resolves on main.
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canAddDecisionConcern(role, decision) && userId !== null && main?.head_commit_id && (
          <DecisionLinkPicker
            commitId={main.head_commit_id}
            modelId={modelId}
            selected={[]}
            placeholder="Add a capability or system this decision concerns…"
            onAdd={(elementId) => {
              const headCommitId = main.head_commit_id;
              if (!headCommitId || elementLinks.some((l) => l.linked_id === elementId)) return;
              void (async () => {
                try {
                  const link = await createDecisionLink(supabase, { decisionId: decision.id, linkedType: 'element', linkedId: elementId, createdBy: userId });
                  const element = (await getElementsByIds(supabase, headCommitId, [elementId])).get(elementId);
                  if (element) applyNewConcern(link, element);
                } catch (e) {
                  reportError('Could not add this concern.', e);
                }
              })();
            }}
            onRemove={() => undefined}
          />
        )}
        </CollapsibleSection>
      </Panel>

      {principlesFollowed + principlesDeparted > 0 && (
        <Text as="p" size="sm" tone="muted">
          Principles in view: {principlesFollowed} followed, {principlesDeparted} departed from.{' '}
          <a href="#decision-principles">Review them</a>.
        </Text>
      )}

      {nextStep !== null && <DecisionNextStepCard step={nextStep} onAction={onNextStepAction} busy={askBusy} askedNames={askedNames} error={askError} showSecondOpinion={secondOpinion.available} />}
      {(options.length > 0 || canAddOption) && (
        <Panel>
          <CollapsibleSection title="Options" meta={`(${String(options.length)})`}>
          {pendingOptions.waiting > 0 && (
            <div role={pendingOptions.status === 'failed' ? 'alert' : 'status'} data-testid="pending-options">
              {pendingOptions.status === 'failed' ? (
                <>
                  <Text as="p">
                    {pendingOptions.waiting === 1 ? 'One suggested option is not saved yet.' : `${String(pendingOptions.waiting)} suggested options are not saved yet.`} {pendingOptions.error} The ones already saved are below. Nothing is lost: you can try again.
                  </Text>
                  <Button variant="secondary" onClick={pendingOptions.retry}>
                    Save them again
                  </Button>{' '}
                  <Button variant="secondary" onClick={pendingOptions.discard}>
                    Leave them out
                  </Button>
                </>
              ) : (
                <Text as="p" size="sm">
                  Saving your suggested options… {String(pendingOptions.waiting)} to go.
                </Text>
              )}
            </div>
          )}
          {baselineOption !== undefined && (
            <DecisionBaselineCard
              key={`${decision.stay_risk}\u0000${decision.stay_reason}`}
              stayRisk={decision.stay_risk}
              stayReason={decision.stay_reason}
              canEdit={canEditBaseline}
              canChoose={canChoose && (baselineBranch === undefined || baselineBranch.status === 'draft')}
              isChosen={chosenOption?.id === baselineOption.id}
              busy={optionsState.status === 'baseline'}
              onSave={(risk, reason) => {
                void optionsState.saveBaselineText(decisionId, risk, reason);
              }}
              onChoose={() => {
                setChoosing({ optionId: baselineOption.id, branchId: baselineOption.branch_id });
                setReasons('');
              }}
            />
          )}
          {baselineOption === undefined && canEditBaseline && userId !== null && (
            <div className={styles.addOptionForm}>
              <Text as="p" tone="muted" size="sm">
                Every decision compares its options against staying as we are. This one has no baseline yet.
              </Text>
              <Button
                variant="secondary"
                disabled={optionsState.status === 'baseline'}
                onClick={() => {
                  void optionsState.addBaselineOption({ orgId, modelId, decisionId, userId, projectId: decision.project_id });
                }}
              >
                {optionsState.status === 'baseline' ? 'Adding…' : 'Add the "Stay as we are" baseline'}
              </Button>
            </div>
          )}
          {scoredOptions.length === 0 ? null : (
            (() => {
              const nameOf = (id: UUID) => profileLabel(members.find((m) => m.member.user_id === id)?.profile);
              const criteriaOptions: DecisionCriteriaOption[] = scoredOptions.map((o) => {
                const b = o.branch_id !== null ? linkedBranchesById.get(o.branch_id) : undefined;
                return {
                  optionId: o.id,
                  branchId: b?.id ?? null,
                  label: o.title,
                  status: b?.status ?? 'draft',
                  statusLabel: o.branch_id === null ? (decision.status === 'proposed' ? 'candidate' : 'not chosen') : undefined,
                  isChosen: b?.id === decision.branch_id,
                  summary: b !== undefined && comparison.status === 'ready' ? (comparison.optionSummaries.get(b.id) ?? null) : null,
                  canChoose: canChoose && (b === undefined || b.status === 'draft'),
                  description: o.summary.trim() !== '' ? o.summary : (b?.description ?? null),
                  provenance: optionRowProvenance(o, nameOf) ?? optionProvenance(b ? pendingOptions.marks.get(b.id) : undefined, nameOf),
                  sources: sourcesByOption.get(o.id) ?? (b ? sourcesByBranch.get(b.id) : undefined) ?? [],
                };
              });
              return (
                <div id="decision-compare">
                <DecisionCriteriaGrid
                  decisionId={decisionId}
                  options={criteriaOptions}
                  canRate={canRate}
                  userId={userId}
                  neededBy={decision.needed_by}
                  orgSlug={orgSlug}
                  modelSlug={modelSlug}
                  commitId={main?.head_commit_id ?? null}
                  onChoose={(optionId, branchId) => {
                    setChoosing({ optionId, branchId });
                    setReasons('');
                  }}
                  chooseNote={decision.status === 'proposed' && !canChooseDecisionOption(role) ? chooseNote(members.filter((m) => m.member.role === 'owner' || m.member.role === 'architect').map((m) => profileLabel(m.profile))) : null}
                  canWorkOnChange={canCreateChangeBranch(role)}
                  canWorkOnCandidate={canCreateChangeBranch(role) && decision.status === 'proposed'}
                  onWorkOnThisChange={(branchId) => {
                    setRef({ kind: 'branch', branchId });
                    void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
                  }}
                  onWorkOnOption={workOnOption}
                  canResearch={canResearch}
                  onResearch={(branchId, label) => { setResearchTarget({ branchId, label }); }}
                  ratingsState={ratingsState}
                />
                </div>
              );
            })()
          )}
          {branchLinks.some((link) => !linkedBranchesById.get(link.linked_id)) && (
            <Text as="p" tone="muted" size="sm">
              A linked option that no longer resolves.
            </Text>
          )}

          {/* Starting points are for beginning a list of options. Once there are options (the Designer's, or ones added by hand) they are already in the list, so they are not shown again (Simon, 2026-11-20). */}
          {canAddOption && scoredOptions.length === 0 && estateSupporters !== null && concernedCapabilityIds.length > 0 && (
            <div data-testid="option-suggestions">
              <Text as="p" size="sm" tone="muted">
                Starting points, read from what Atlas holds (no AI). They are only suggestions: add one, change it, or ignore them.
              </Text>
              <ul className={styles.suggestionList}>
                {suggestOptions(
                  concernedCapabilityIds.map((id) => linkedElementsById.get(id)?.name ?? ''),
                  estateSupporters,
                ).map((suggestion) => (
                  <li key={suggestion.title}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAddingOption(true);
                        setOptionTitle(suggestion.title);
                      }}
                    >
                      {suggestion.title}
                    </Button>{' '}
                    <Text as="span" size="xs" tone="muted">
                      {suggestion.reason}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canAddOption && !addingOption && (
            <Button
              variant="secondary"
              onClick={() => {
                setAddingOption(true);
                setOptionTitle('');
              }}
            >
              + Add an option
            </Button>
          )}
          {canAddOption && addingOption && (
            <div className={styles.addOptionForm}>
              <input
                className={styles.input}
                type="text"
                aria-label="What's this option?"
                placeholder="What's this option? (e.g. Replace with Workday)"
                value={optionTitle}
                onChange={(e) => {
                  setOptionTitle(e.target.value);
                }}
              />
              <Button
                variant="primary"
                disabled={optionsState.status === 'adding' || optionTitle.trim().length === 0}
                onClick={() => {
                  if (!userId) return;
                  void optionsState.addOption({ decisionId, title: optionTitle, userId }).then((added) => {
                    if (added) setAddingOption(false);
                  });
                }}
              >
                {optionsState.status === 'adding' ? 'Adding…' : 'Add option'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setAddingOption(false);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          {optionsState.error !== null && <Text as="p">{optionsState.error}</Text>}
          </CollapsibleSection>
        </Panel>
      )}

      {hasReplaceOrBuildOption && capabilityConcerns.map((capability) => {
        const templateRef = attributesRecord(capability.attributes).templateRef;
        if (typeof templateRef !== 'string') return null;
        return <CapabilityProducts key={capability.element_id} templateRef={templateRef} title={`Products that can support ${capability.name}`} />;
      })}

      {(comparisonOptions.length > 0 || scoredOptions.length > 0) && (
        <div id="decision-effects">
        <Panel>
          <CollapsibleSection title="What each option changes" meta="per option">

          {comparison.status === 'empty' && scoredOptions.length > 0 && (
            <Text as="p">These options don't change the structure of anything in scope.</Text>
          )}
          {comparison.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Comparing…
            </Text>
          )}
          {comparison.status === 'error' && <Text as="p">{comparison.message}</Text>}

          {comparison.status === 'ready' &&
            (() => {
              const { visible, collapsed } = groupWhatChangesRows(comparison.whatChangesRows);
              const visibleGroups = groupConsecutiveByLabel(visible);
              // `OptionComparisonRow.branchId` is `UUID | null` only because the type is shared with the "Current (main)" row — every row in `comparison.options` always has a real branch id.
              const optionBranchIds = comparison.options.map((o) => o.branchId).filter((id): id is UUID => id !== null);
              return (
                <>
                  {visible.length === 0 ? (
                    <Text as="p">These options don't change the structure of anything in scope.</Text>
                  ) : (
                    !compact && <div className={styles.tableWrap}>
                      <table className={styles.comparisonTable}>
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>{comparison.main.label}</th>
                            {comparison.options.map((o) => (
                              <th key={o.branchId}>
                                {o.label}
                                {o.branchId !== null && comparison.mainDriftedByBranchId.has(o.branchId) && (
                                  <Text as="p" size="sm" tone="muted">
                                    The live model has moved since this option was started
                                  </Text>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGroups.map((group) => (
                            <WhatChangesRowGroup key={group.groupLabel} group={group} optionBranchIds={optionBranchIds} />
                          ))}
                          {/* The unchanged rows join this same table once opened, so their columns line up with the headings above. */}
                          {whatChangesExpanded &&
                            groupConsecutiveByLabel(collapsed).map((group) => (
                              <WhatChangesRowGroup key={`unchanged-${group.groupLabel}`} group={group} optionBranchIds={optionBranchIds} />
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {compact && (visible.length > 0 || whatChangesExpanded) && (
                    <div className={styles.mobileChangeCards} data-testid="what-changes-cards">
                      {comparison.options.map((option) => option.branchId !== null && (
                        <article key={option.branchId} className={styles.changeCard} aria-label={`What this option changes — ${option.label}`}>
                          <Text as="h3" size="md">{option.label}</Text>
                          {comparison.mainDriftedByBranchId.has(option.branchId) && (
                            <Text as="p" size="sm" tone="muted">The live model has moved since this option was started.</Text>
                          )}
                          {groupConsecutiveByLabel(whatChangesExpanded ? [...visible, ...collapsed] : visible).map((group) => (
                            <div key={group.groupLabel} className={styles.changeGroup}>
                              <Text as="h4" size="sm">{group.groupLabel}</Text>
                              {group.rows.map((row) => (
                                <div key={row.id} className={styles.changeRow}>
                                  {row.rowLabel !== group.groupLabel && <Text as="span" size="sm">{row.rowLabel}</Text>}
                                  <div><Text as="span" size="xs" tone="muted">Today</Text><Text as="span" size="sm">{row.main.display}</Text></div>
                                  <div><Text as="span" size="xs" tone="muted">With this option</Text><Text as="span" size="sm">{row.options.get(option.branchId ?? '')?.display ?? '—'}</Text></div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </article>
                      ))}
                    </div>
                  )}

                  {collapsed.length > 0 && (
                    <div className={styles.field}>
                      <button
                        type="button"
                        className={styles.collapsedToggle}
                        onClick={() => {
                          setWhatChangesExpanded((e) => !e);
                        }}
                      >
                        {collapsed.length} row{collapsed.length === 1 ? '' : 's'} unchanged in all options {whatChangesExpanded ? '▲' : '▼'}
                      </button>
                      {!compact && whatChangesExpanded && visible.length === 0 && (
                        <div className={styles.tableWrap}>
                          <table className={styles.comparisonTable}>
                            <tbody>
                              {groupConsecutiveByLabel(collapsed).map((group) => (
                                <WhatChangesRowGroup key={group.groupLabel} group={group} optionBranchIds={optionBranchIds} />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {comparison.options.map((o) => {
                    if (o.branchId === null) return null;
                    const alsoAffected = comparison.alsoAffectedByBranchId.get(o.branchId) ?? [];
                    if (alsoAffected.length === 0) return null;
                    return (
                      <div key={o.branchId} className={styles.field}>
                        <Text as="h3" size="sm">
                          Also affected — {o.label}
                        </Text>
                        <ul className={styles.linkList}>
                          {alsoAffected.map((a: AlsoAffectedElement) => {
                            const owners = [...a.ownersByRole.entries()].flatMap(([role, list]) => list.map((owner) => `${owner.name} (${role})`));
                            return (
                              <li key={a.element.element_id} className={styles.linkRow}>
                                <ElementTypeGlyph type={a.element.element_type} />
                                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${a.element.element_id}`}>
                                  <Text as="span">{a.element.name}</Text>
                                </Link>
                                {owners.length > 0 && (
                                  <Text as="span" size="sm" tone="muted">
                                    Owned by {owners.join(', ')}
                                  </Text>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </CollapsibleSection>
        </Panel>
        </div>
      )}

      {decision.status === 'proposed' && <SecondOpinion key={`${decisionId}:${userId ?? ''}`} orgId={orgId} userId={userId} decisionId={decisionId} orgSlug={orgSlug} shareCost={shareCost} availability={secondOpinion} />}

      <KeptQuestions
        decisionId={decisionId}
        nameOfUser={(id) => {
          const member = members.find((m) => m.member.user_id === id);
          return member ? profileLabel(member.profile) : 'a former member';
        }}
      />

      {decision.status === 'accepted' && chosenBranch !== undefined && (
        <DecisionGoLive
          branch={chosenBranch}
          canEdit={canCreateChangeBranch(role)}
          onSaved={refreshOptionsAndArguments}
          onWorkOnChange={(branchId) => {
            setRef({ kind: 'branch', branchId });
            void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
          }}
        />
      )}

      {choosing !== null && (
        <div id="decision-confirm-choice"><Panel>
          <Text as="h2" size="lg">Confirm the choice</Text>
            <div className={styles.field}>
              <Text as="label" size="sm" tone="muted">
                Why this option
              </Text>
              <textarea
                className={styles.textarea}
                placeholder="The reasons this option was chosen over the others"
                value={reasons}
                onChange={(e) => {
                  setReasons(e.target.value);
                }}
              />
              <Text as="label" size="sm" tone="muted">
                What would make us reconsider (optional)
              </Text>
              <textarea
                className={styles.textarea}
                placeholder="For example: the vendor price rises, support is extended, or the migration slips past March"
                value={reconsiderIf}
                onChange={(e) => {
                  setReconsiderIf(e.target.value);
                }}
              />
              <label>
                <Text as="span" size="sm" tone="muted">
                  Look at this decision again by (optional)
                </Text>
                <input
                  type="date"
                  value={reviewBy}
                  onChange={(e) => {
                    setReviewBy(e.target.value);
                  }}
                />
              </label>
              <div className={styles.addOptionForm}>
                <Button
                  variant="primary"
                  disabled={optionsState.status === 'choosing' || reasons.trim().length === 0}
                  onClick={() => {
                    void optionsState.chooseOption(decisionId, choosing.optionId, choosing.branchId, reasons, { reconsiderIf, reviewBy }).then((chosen) => {
                      if (chosen) {
                        setChoosing(null);
                        setReconsiderIf('');
                        setReviewBy('');
                      }
                    });
                  }}
                >
                  {optionsState.status === 'choosing' ? 'Choosing…' : 'Confirm choice'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChoosing(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
        </Panel></div>
      )}

      <div id="decision-principles">
        <DecisionPrinciplesPanel
          principles={principlesState.principles}
          links={principlesState.links}
          editable={canLinkDecisionPrinciples(role, decision)}
          savingIds={principlesState.savingIds}
          error={principlesState.error}
          principlesHref={`/o/${orgSlug}/m/${modelSlug}/principles`}
          onSetStance={principlesState.setStance}
        />
      </div>


      {args.length > 0 && (
        <Panel>
          <Text as="h2" size="lg">
            Arguments
          </Text>
          {args.length === 0 ? null : (
            <ul className={styles.linkList}>
              {args.map((arg) => (
                <li key={arg.id} className={styles.linkRow}>
                  <Chip tone={arg.stance === 'for' ? 'ok' : arg.stance === 'against' ? 'danger' : 'neutral'}>{arg.stance}</Chip>
                  <Text as="span" size="sm">
                    {arg.body}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <DecisionPacks decisionId={decision.id} canFreeze={canChooseDecisionOption(role)} canSign={canChooseDecisionOption(role)} userId={userId} nameOfUser={(id) => { const m = members.find((x) => x.member.user_id === id); return m ? profileLabel(m.profile) : 'a former member'; }} commitId={main?.head_commit_id ?? null} buildMarkdown={buildAdrMarkdown} />

      <Panel>
        <Text as="h2" size="lg">
          Comments
        </Text>
        <CommentsSection key={commentsKey} orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType="decision" anchorId={decisionId} branchId={null} />
      </Panel>

      {researchTarget !== null && userId !== null && (
        <WebResearchDialog
          decisionId={decisionId}
          branchId={researchTarget.branchId}
          optionLabel={researchTarget.label}
          decisionTitle={decision.title}
          capabilityNames={concernedCapabilities.map((capability) => capability.name)}
          productNames={reviewedNamesFor(researchTarget.branchId).productNames}
          vendorNames={reviewedNamesFor(researchTarget.branchId).vendorNames}
          catalogueProducts={knownCatalogueProducts}
          userId={userId}
          existingUrls={(sourcesByBranch.get(researchTarget.branchId) ?? []).flatMap((source) => (source.kind === 'web' ? [source.url] : []))}
          citedElsewhereUrls={(optionSources.data ?? []).flatMap((source) => (source.kind === 'web' && source.branchId !== researchTarget.branchId ? [source.url] : []))}
          earlierSearchUrls={earlierResearchUrls}
          onClose={() => { setResearchTarget(null); }}
          onSaved={() => {
            setResearchTarget(null);
            void queryClient.invalidateQueries({ queryKey: ['optionSources', decisionId] });
          }}
          onUseAsOption={async (candidate, optionId) => {
            const title = researchOptionTitle(candidate);
            const already = (readyState?.options ?? []).find((option) => option.title.trim().toLowerCase() === title.toLowerCase());
            if (already !== undefined) return `An option for this page already exists: ${already.title}.`;
            const result = await addResearchOption({
              orgId,
              modelId,
              decisionId,
              userId,
              projectId: decision.project_id,
              candidate,
              optionId,
            });
            applyNewOption(result.link, result.branch);
            void queryClient.invalidateQueries({ queryKey: ['optionSources', decisionId] });
            return result.sourceError;
          }}
        />
      )}
    </div>
  );
}

interface WhatChangesRowGroupData {
  groupLabel: string;
  rows: WhatChangesRow[];
}

/**
 * F6.3 (Part B) rendering-only grouping — chunks consecutive rows sharing
 * the same `groupLabel` (decision 2: "group visible rows under the
 * capability name") so the table shows the group name once, not once per
 * metric row. `buildWhatChangesRows` already emits same-group rows
 * consecutively; filtering out unchanged rows (`groupWhatChangesRows`)
 * never interleaves two different groups, only shrinks a run, so this
 * stays correct after that filter too. No comparison logic of its own —
 * every row's own `changed`/`display` value was already decided by
 * `whatChangesRows.ts`.
 */
function groupConsecutiveByLabel(rows: readonly WhatChangesRow[]): WhatChangesRowGroupData[] {
  const groups: WhatChangesRowGroupData[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.groupLabel === row.groupLabel) last.rows.push(row);
    else groups.push({ groupLabel: row.groupLabel, rows: [row] });
  }
  return groups;
}

function WhatChangesRowGroup({ group, optionBranchIds }: { group: WhatChangesRowGroupData; optionBranchIds: readonly UUID[] }) {
  const showGroupHeader = group.rows.length > 1 || group.rows[0]?.rowLabel !== group.groupLabel;
  return (
    <>
      {showGroupHeader && (
        <tr>
          {/* Exactly the table's own column count (Row + main + one per option): a larger colSpan adds phantom columns that the table's width is shared across, collapsing the real ones. */}
          <td colSpan={2 + optionBranchIds.length}>
            <Text as="span" size="sm" tone="muted">
              {group.groupLabel}
            </Text>
          </td>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td>{showGroupHeader ? row.rowLabel : row.groupLabel}</td>
          <td>{row.main.display}</td>
          {optionBranchIds.map((branchId) => (
            <td key={branchId}>{row.options.get(branchId)?.display ?? '—'}</td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Cancel a decision (`atlas.cancel_decision`): for a proposed decision that
 * is no longer needed — closed without choosing, with a reason, its draft
 * options cancelled with it. Once cancelled, says who, when and why.
 */
function DecisionCancel({
  decision,
  canCancel,
  cancelledByName,
  onCancelled,
}: {
  decision: DecisionRow;
  canCancel: boolean;
  cancelledByName: string | null;
  onCancelled: (updated: DecisionRow) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (decision.status === 'rejected') {
    return (
      <Panel>
        <Text as="p">
          Cancelled{cancelledByName !== null ? ` by ${cancelledByName}` : ''}
          {decision.decided_at !== null ? ` on ${decision.decided_at.slice(0, 10)}` : ''}
          {decision.cancel_reason !== null ? ` — ${decision.cancel_reason}` : ''}.
        </Text>
      </Panel>
    );
  }
  if (!canCancel) return null;
  if (!open) {
    return (
      <div className={styles.field}>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(true);
          }}
        >
          Cancel decision…
        </Button>
      </div>
    );
  }
  return (
    <Panel>
      <div className={styles.field}>
        <label htmlFor="cancel-decision-reason">
          <Text as="span" size="sm" tone="muted">
            Why is this decision being cancelled?
          </Text>
        </label>
        <textarea
          id="cancel-decision-reason"
          className={styles.textarea}
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
        <Text as="p" size="sm" tone="muted">
          It stays in the decision log, marked cancelled. Any options still in draft are cancelled with it.
        </Text>
        <div className={styles.addOptionForm}>
          <Button
            variant="primary"
            disabled={busy || reason.trim().length === 0}
            onClick={() => {
              setBusy(true);
              void cancelDecision(supabase, decision.id, reason)
                .then(onCancelled)
                .catch((e: unknown) => {
                  reportError('Could not cancel this decision.', e);
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {busy ? 'Cancelling…' : 'Confirm cancel'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setReason('');
            }}
          >
            Keep it
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Edit a proposed decision's own fields — title, context, owner, needed-by
 * date and Lens map link (`updateDecision`, a plain RLS-gated update). Its
 * creator or an org owner/architect, while proposed; closed once decided or
 * cancelled, like everything else on the decision.
 */
function DecisionEdit({ decision, members, onSaved, startOpen }: { decision: DecisionRow; members: { id: UUID; label: string }[]; onSaved: (updated: DecisionRow) => void; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [title, setTitle] = useState(decision.title);
  const [statement, setStatement] = useState(decision.statement);
  const [ownerId, setOwnerId] = useState(decision.owner_id);
  const [neededBy, setNeededBy] = useState(decision.needed_by ?? '');
  const [lensMapUrl, setLensMapUrl] = useState(decision.lens_map_url ?? '');
  const [busy, setBusy] = useState(false);

  function start() {
    setTitle(decision.title);
    setStatement(decision.statement);
    setOwnerId(decision.owner_id);
    setNeededBy(decision.needed_by ?? '');
    setLensMapUrl(decision.lens_map_url ?? '');
    setOpen(true);
  }

  if (!open) {
    return (
      <div className={styles.field}>
        <Button variant="secondary" onClick={start}>
          ✎ Edit decision
        </Button>
      </div>
    );
  }

  return (
    <Panel>
      <form
        className={styles.editForm}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void updateDecision(supabase, decision.id, {
            title: title.trim(),
            statement: statement.trim(),
            ...(decision.ai_draft_agent !== null && statement.trim() !== decision.statement.trim() ? { aiDraftEdited: true } : {}),
            ownerId,
            neededBy: neededBy === '' ? null : neededBy,
            lensMapUrl: lensMapUrl.trim() === '' ? null : lensMapUrl.trim(),
          })
            .then((updated) => {
              onSaved(updated);
              setOpen(false);
            })
            .catch((err: unknown) => {
              reportError('Could not save this decision.', err);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <label>
          <Text as="span" size="sm" tone="muted">
            Title
          </Text>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label>
          <Text as="span" size="sm" tone="muted">
            Context
          </Text>
          <textarea
            className={styles.textarea}
            placeholder="What needs deciding, and why now"
            value={statement}
            onChange={(e) => {
              setStatement(e.target.value);
            }}
          />
        </label>
        <label>
          <Text as="span" size="sm" tone="muted">
            Owner
          </Text>
          <select
            value={ownerId}
            onChange={(e) => {
              setOwnerId(e.target.value);
            }}
          >
            {!members.some((m) => m.id === ownerId) && <option value={ownerId}>A former member</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Text as="span" size="sm" tone="muted">
            Needed by
          </Text>
          <input
            type="date"
            value={neededBy}
            onChange={(e) => {
              setNeededBy(e.target.value);
            }}
          />
        </label>
        <label>
          <Text as="span" size="sm" tone="muted">
            Lens map link (optional)
          </Text>
          <input
            type="url"
            placeholder="https://…"
            value={lensMapUrl}
            onChange={(e) => {
              setLensMapUrl(e.target.value);
            }}
          />
        </label>
        <div className={styles.addOptionForm}>
          <Button variant="primary" type="submit" disabled={busy || title.trim().length === 0}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  );
}
