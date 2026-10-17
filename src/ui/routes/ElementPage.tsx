import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ATTRIBUTE_SCHEMA_BY_TYPE, attributeDefinitionToFieldSchema, type AttributeFieldSchema } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { AliasRow, BranchIntent, BranchRow, SourceRow } from '../../db/types';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { AttributeEditRow } from '../components/AttributeEditRow/AttributeEditRow';
import { AttributeRow } from '../components/AttributeRow/AttributeRow';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { ChangesTouchingSection } from '../components/ChangesTouchingSection/ChangesTouchingSection';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ConvertToModuleAction } from '../components/ConvertToModuleAction/ConvertToModuleAction';
import { ElementDecisionsSection } from '../components/ElementDecisionsSection/ElementDecisionsSection';
import { ElementHeader } from '../components/ElementHeader/ElementHeader';
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { HistoryTimeline } from '../components/HistoryTimeline/HistoryTimeline';
import { MergeIntoAction } from '../components/MergeIntoAction/MergeIntoAction';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { ModulesSection } from '../components/ModulesSection/ModulesSection';
import { Panel } from '../components/Panel/Panel';
import { AddInterfaceForm } from '../components/PlatformFlowsSection/AddInterfaceForm';
import { InterfacesSection } from '../components/PlatformFlowsSection/InterfacesSection';
import { PlatformFlowsSection } from '../components/PlatformFlowsSection/PlatformFlowsSection';
import { RelationshipsSection } from '../components/RelationshipGroup/RelationshipsSection';
import { RemoveFromModelAction } from '../components/RemoveFromModelAction/RemoveFromModelAction';
import { RetireAction } from '../components/RetireAction/RetireAction';
import { StructureSection } from '../components/StructureSection/StructureSection';
import { Text } from '../components/Text/Text';
import { ValueStreamDeactivateAction } from '../components/ValueStreamDeactivateAction/ValueStreamDeactivateAction';
import { ValueStreamGateNotice } from '../components/ValueStreamGateNotice/ValueStreamGateNotice';
import { ValueStreamImpactSection } from '../components/ValueStreamImpactSection/ValueStreamImpactSection';
import { ValueStreamStagesSection } from '../components/ValueStreamStagesSection/ValueStreamStagesSection';
import { useAuth } from '../auth/useAuth';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { ViewingBranchBanner } from '../branches/ViewingBranchBanner/ViewingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { hintedModelId, useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { isViewingMode } from '../branches/viewingMode';
import { parseMergePrefillFromSearchParams } from '../duplicates/mergePrefill';
import { ProposeChangePicker } from '../home/ProposeChangePicker';
import { useModels } from '../models/useModels';
import { canCreateChangeBranch, canEditBranch, canEditValueStreamStructure, useMembership } from '../orgs/useMembership';
import { canStartProject } from '../orgs/roleGates';
import { startProjectFromElementHref } from '../projects/projectPrefill';
import { useAttributeDefinitions } from '../orgs/useAttributeDefinitions';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf, refQueryParam } from '../../db/ref';
import { elementBreadcrumbSegments } from '../nav/elementBreadcrumbSegments';
import { ALIAS_TYPE_LABELS, aliasAsFact } from '../elements/aliasLabels';
import { useElementPage } from '../elements/useElementPage';
import { useElementEditor, type DraftValue } from '../elements/useElementEditor';
import { useAttestation } from '../elements/useAttestation';
import { useElementRename } from '../elements/useElementRename';
import { ActorMemberPicker } from '../elements/ActorMemberPicker';
import { attributesRecord } from '../elements/attributesRecord';
import { interfaceTypeLabelOf, isIntegrationInterface, isIntegrationPlatform, isPlatform } from '../elements/systemKind';
import { useRouteTiming } from '../perf/useRouteTiming';
import { useValueStreamImpact } from '../valueStreams/useValueStreamImpact';
import styles from './ElementPage.module.css';

/**
 * The element page (UI-principles.md §4) — the product's unit of trust.
 * Attributes with provenance badges, relationships grouped by type, and
 * designed empty states are the three things Sprint U1 step 3 named
 * explicitly; structure and history come from the same materialised data
 * at no extra cost. Sprint U1 step 5 makes `Edit` (§4.2) real: owner/
 * architect, at `main`, editing attribute values — see
 * src/ui/elements/useElementEditor.ts for what that does and doesn't cover
 * yet.
 *
 * Sprint C1 step 9 closes a gap left open since step 4: `useElementEditor`
 * and `useElementRename` (plus `useElementRetract`, which Prompt 7k item 5
 * later replaces with `useElementRetire`/`useElementRemoveFromModel`)
 * were already generalised to take any `branch: BranchRow`, but this page
 * kept feeding them `useMainBranch()` regardless of `?ref=` — so "editing
 * while a change is selected writes deltas to the branch" (the user's
 * Sprint C1 brief) had no real path to a change branch at all until now.
 * `useEditingBranch` (src/ui/branches/useEditingBranch.ts) resolves the
 * right branch row for the current ref and `canEditBranch` (not
 * `canEditOnMain`) gates `Edit` for either main or a draft change branch,
 * per its own role rules.
 *
 * Decisions and comments have no backing table yet (`decisions`/
 * `comments` — deferred to Sprints D1/M1, per the user's own step 3a
 * decision) and say so plainly rather than rendering SPEC's designed
 * empty-state copy for a feature that doesn't exist yet.
 */
export function ElementPage() {
  const { orgSlug, modelSlug, elementId } = useParams<{ orgSlug: string; modelSlug: string; elementId: string }>();
  const [searchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const viewing = isViewingMode(searchParams);
  // Bug fix: this page used to call `refLabelOf(ref)` with no second
  // argument at all — every other ref-aware page resolves the ref's own
  // label via `useBranchLabel` first, so this was the one page whose
  // breadcrumb never showed "Change: {title}" for a selected change, only
  // the short id fragment `refLabelOf`'s own fallback uses. This is also
  // the one page ever reached with a `commit:` ref (`VersionDiffView.tsx`'s
  // own "each changed element links at that same commit") — `useBranchLabel`
  // resolves that ref kind's own commit title too, so a reader following a
  // diff link here sees "Merge: Datasphere," not "commit 35a1b90f."
  const { label: branchLabel } = useBranchLabel(ref);
  const { userId } = useAuth();
  const location = useLocation();
  // Handoff — Flow: Add a system, step 7: `HomeSearch`'s onCreated navigates
  // here with `{ justCreated: elementType }` in router state — the toast
  // offering "Add another <type>" reads it once, on landing, and it is
  // never restored on a later reload of the same URL (router state doesn't
  // survive one). `justAddedElementId` is separate: it tracks a
  // relationship just added *from this page* (the "+ Add" under Uses), not
  // the element-create toast.
  const [justCreatedType] = useState<string | null>(() => (location.state as { justCreated?: string } | null)?.justCreated ?? null);
  const [toastDismissed, setToastDismissed] = useState(false);
  const [justAddedElementId, setJustAddedElementId] = useState<string | null>(null);
  // Sprint 7i item 4: "Propose a change" — the contributor-at-main path
  // `ElementHeader.tsx`'s own former comment named as a real, named gap.
  const [proposingChange, setProposingChange] = useState(false);
  // Prompt pack F0: "element page → correct or propose" — `correct` is the
  // more common reason to be fixing something from an element's own page
  // (provenance work), so it's the default; a one-line toggle switches to
  // `propose` for a genuine future plan started from here.
  const [proposeChangeIntent, setProposeChangeIntent] = useState<BranchIntent>('correct');
  // Prompt 7k item 5: "Retire…"/"Remove from model…" — same inline-panel
  // convention as `proposingChange` above, one at a time (opening either
  // closes the other, same as `editor`'s own idle/editing exclusivity).
  const [retiring, setRetiring] = useState(false);
  const [removingFromModel, setRemovingFromModel] = useState(false);
  // F4's own "Merge into…" from the duplicates report (`mergePrefill.ts`):
  // `?mergeTargetId=...&mergeTargetName=...` opens this panel already
  // pointed at the other candidate — `null` for the ordinary case (E7's own
  // "Merge into…" from the header), which opens to a blank search step.
  // Read once, via the lazy initializers below, same convention
  // `DecisionsView.tsx`'s own `prefill`-seeded state uses — never cleared
  // from the URL afterward, so the link stays valid if revisited.
  const mergePrefill = parseMergePrefillFromSearchParams(searchParams);
  // E7's own "Merge into…" — same inline-panel convention as `retiring`/
  // `removingFromModel` above.
  const [merging, setMerging] = useState(() => mergePrefill !== null);
  // "Convert to a module of…" — same inline-panel convention as `merging` above.
  const [converting, setConverting] = useState(false);
  // ADR-023/F6's "Deactivate…"/"Reactivate…" — same inline-panel
  // convention, one panel covering both directions (`ValueStreamDeactivateAction`'s
  // own `mode` prop) rather than two separate booleans.
  const [deactivatePanel, setDeactivatePanel] = useState<'deactivate' | 'reactivate' | null>(null);
  const navigate = useNavigate();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);

  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const { branch: mainBranch, loading: mainBranchLoading, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  // S1 item 15 (A2 remainder): same dedup hint as every other page here.
  const { state, reload } = useElementPage(hintedModelId(model?.id, ref, mainBranchLoading) ?? '', elementId ?? '', ref, mainBranch?.head_commit_id ?? null);
  // E8 ("performance") phase 1: this route's own resolve/first-paint/data-complete marks — see useRouteTiming.ts's own module comment.
  useRouteTiming('element-detail', state.status === 'ready');
  // A dead end for the element at this ref (retracted, or never existed
  // here) sends the user straight back to wherever linked here, rather
  // than stranding them on a page with nothing to do — navigate(-1) is a
  // real "back", not a fallback route, since there's no single correct
  // page to land on instead (a search result, a history entry, another
  // element's relationship list...).
  //
  // One exception: when the element was showing a moment ago at a
  // different ref and the user just switched ref on this page ("Back to
  // main" from an element that only exists in the change), going back in
  // history lands on the previous page *at the old ref* — whose URL then
  // re-selects the change the user just left (SelectedRefProvider treats
  // the URL as the truth). The model's home at the newly chosen ref is
  // the honest landing place there.
  const currentRefParam = refParamOf(ref);
  // The ref this page opened at (a lazy initial value, so it's fixed for
  // the page's life). If the element is missing at a *different* ref, the
  // user switched ref here — not a stale link.
  const [refAtOpen] = useState(currentRefParam);
  useEffect(() => {
    // Only for the element this page is showing now: after a merge or a
    // conversion moves the page to another element, the previous one's
    // not-present state can still be here for a render, and acting on it
    // stepped back out of the survivor's page.
    if (state.status !== 'notPresentAtRef' || state.elementId !== elementId) return;
    // A merge or conversion in progress retracts this element itself and
    // then navigates to its result (`onMerged`/`onConverted`); stepping back
    // here first would race it and leave the user on the previous page.
    if (merging || converting) return;
    if (currentRefParam !== refAtOpen) {
      void navigate(`/o/${orgSlug ?? ''}/m/${modelSlug ?? ''}`, { replace: true });
    } else {
      void navigate(-1);
    }
  }, [state, elementId, merging, converting, navigate, currentRefParam, refAtOpen, orgSlug, modelSlug]);
  // F1 ("custom attributes") PR3: this org's own definitions — read-only
  // here (any member, per attribute_definitions_select's RLS), filtered
  // below to the ones that actually apply to this element's type. Called
  // unconditionally like every other data hook on this page (Rules of
  // Hooks); `useAttributeDefinitions` also exposes create/reorder/deprecate,
  // unused here — this page only ever reads.
  const { definitions: attributeDefinitions } = useAttributeDefinitions(organisation?.id ?? null, userId);
  const canEdit = !viewing && editingBranch !== null && canEditBranch(role, editingBranch);
  // The complement of `canEdit` at `main`: a contributor who can create a
  // change branch but has no direct main-write path gets this instead of
  // `Edit` — never both (ElementHeader.tsx passes exactly one).
  const canPropose = ref.kind === 'main' && !canEdit && canCreateChangeBranch(role);
  // Sticky ref close-out: "read-only: under review" — the complement of
  // `canEdit` on a *branch* ref, the other reason (beyond role) `onEdit`
  // can be missing: the branch itself stopped taking commits the moment it
  // left `draft` (`canEditBranch`'s own status gate). `merged`/`rejected`/
  // `archived` are excluded — those are closed, not "under review," and
  // read differently (a merged element is ordinarily viewed via `main`
  // anyway). Gated on `canCreateChangeBranch` the same as `canPropose`
  // above: a viewer already sees everything read-only by design and needs
  // no explanation for it.
  const underReview = !viewing && ref.kind === 'branch' && editingBranch !== null && ['proposed', 'in_review', 'approved'].includes(editingBranch.status) && canCreateChangeBranch(role);
  // See LandscapePage.tsx's identical comment: ADR-018 guarantees main's
  // head is never null in practice; `BranchRow`'s own type hasn't been
  // narrowed yet. `expectedHeadCommitId` for the relationship-add write
  // itself reuses `state.data.commitId`, already established below.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const canAddRelationship = canEdit && searchCommitId !== null;
  // F6 (ADR-023): value-stream structure (a stream's Deactivate…/
  // Reactivate…/"+ Add stage"/stage reorder, and an `enables` edge either
  // direction) needs `canEditValueStreamStructure`'s own narrower "main or
  // a correct-intent change" gate, not the plain `canEdit` above — a
  // capability page can otherwise be fully editable on a `propose` change
  // while still refusing its own "Enables" group.
  const canEditValueStream = !viewing && editingBranch !== null && canEditValueStreamStructure(role, editingBranch);
  const canAddEnablesRelationship = canEditValueStream && searchCommitId !== null;

  // Sprint U4-1 A1: any commit made from this page — a relationship, an
  // attribute edit, a capability tailoring action — can move `main`'s head,
  // which is exactly the commit id the relationship-add search pool reads
  // against (`searchCommitId`, above). Reloading the page's own data
  // without also reloading `mainBranch` left `searchCommitId` pointing at a
  // commit `elements_head` no longer has any rows for, so a second search
  // in the same visit found nothing at all.
  const reloadAfterCommit = () => {
    reload();
    reloadMainBranch();
  };

  const data = state.status === 'ready' ? state.data : null;
  // F1 PR3: this element type's own applicable definitions — deprecated
  // ones are excluded from the editable set entirely (they "disappear from
  // the create/edit form's field list," the plan's own wording), but stay
  // visible in the read-only table when this element already has a value
  // under that key (`customFieldsForDisplay` below) — "a value already set
  // keeps rendering... unchanged."
  const elementType = data?.element.element_type;
  // ADR-023/F6's "Impact" section (system/container/capability pages): a
  // capability page's own id, alone; a system/container page's own
  // `supports` edges, already loaded here (`data.relationships`/
  // `data.relationshipEndpoints`) — `useValueStreamImpact.ts` only fetches
  // the `enables`/`value_stream` half of the hop this doesn't already have.
  const isImpactEligible = elementType === 'system' || elementType === 'container' || elementType === 'capability';
  const impactCapabilityIds: UUID[] =
    elementType === 'capability' && data
      ? [data.element.element_id]
      : (data?.relationships.filter((r) => r.relationship_type === 'supports' && r.from_element_id === data.element.element_id).map((r) => r.to_element_id) ?? []);
  const impactCapabilitiesById: ReadonlyMap<UUID, ElementsHeadRow> = elementType === 'capability' && data ? new Map([[data.element.element_id, data.element]]) : (data?.relationshipEndpoints ?? new Map());
  const valueStreamImpact = useValueStreamImpact(model?.id ?? null, ref, mainBranch?.head_commit_id ?? null, isImpactEligible, impactCapabilityIds, impactCapabilitiesById);
  const applicableDefinitions = elementType ? attributeDefinitions.filter((d) => d.applies_to.includes(elementType)) : [];
  const customFieldsForEditing: AttributeFieldSchema[] = applicableDefinitions.filter((d) => d.deprecated_at === null).map(attributeDefinitionToFieldSchema);
  const customFieldsForDisplay: AttributeFieldSchema[] = applicableDefinitions
    .filter((d) => d.deprecated_at === null || data?.facts.has(d.key))
    .map(attributeDefinitionToFieldSchema);
  const editor = useElementEditor({
    modelId: model?.id ?? '',
    orgId: organisation?.id ?? '',
    userId,
    element: data?.element ?? PLACEHOLDER_ELEMENT,
    facts: data?.facts ?? EMPTY_FACTS,
    customFields: customFieldsForEditing,
    branch: editingBranch ?? PLACEHOLDER_BRANCH,
    expectedHeadCommitId: data?.commitId ?? '',
    onSaved: reloadAfterCommit,
  });
  // ADR-025: "Still accurate", behind the same gate as Edit.
  const attestation = useAttestation({ modelId: model?.id ?? '', orgId: organisation?.id ?? '', userId, branch: editingBranch, onConfirmed: reloadAfterCommit });
  // Sprint U4-1 D3: called unconditionally, same reasoning as `editor`
  // above (the Rules of Hooks) — only actually offered to
  // ElementHeader.tsx (its `rename` prop) once `canEdit`. Prompt 7h bug
  // fix: every element type now, not just capability — `useElementRename`
  // was already fully generic; the old `element_type === 'capability'`
  // half of this gate (inherited from `CapabilityRetractAction.tsx`'s own
  // former bundling with rename) was an artificial restriction on an
  // already-correct hook, not a real limitation of what renaming does.
  const rename = useElementRename({
    modelId: model?.id ?? '',
    orgId: organisation?.id ?? '',
    userId,
    element: data?.element ?? PLACEHOLDER_ELEMENT,
    facts: data?.facts ?? EMPTY_FACTS,
    branch: editingBranch ?? PLACEHOLDER_BRANCH,
    expectedHeadCommitId: data?.commitId ?? '',
    onSaved: reloadAfterCommit,
  });

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader orgId={organisation?.id ?? null} />
        <div className={navStyles.body}>
          <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
          <main className={styles.main}>
            <Text tone="muted">Loading…</Text>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppHeader orgId={organisation?.id ?? null} />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
        {viewing ? <ViewingBranchBanner activeRef={ref} /> : <EditingBranchBanner activeRef={ref} modelId={model.id} orgSlug={orgSlug ?? ''} modelSlug={model.slug} showModeShortcuts={false} />}
        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">Nothing here yet.</Text>}
        {state.status === 'notPresentAtRef' && <Text tone="muted">Going back…</Text>}
        {state.status === 'ready' && (
          <>
            <Breadcrumb
              org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
              model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
              refLabel={refLabelOf(ref, branchLabel)}
              segments={elementBreadcrumbSegments(state.data.element, state.data.parent, orgSlug ?? '', model.slug, refQueryParam(ref, viewing))}
            />
            <ElementHeader
              element={state.data.element}
              existsFact={state.data.facts.get('$exists')}
              existsSource={state.data.sources.get(state.data.facts.get('$exists')?.source_id ?? '')}
              onEdit={canEdit && editor.status === 'idle' ? editor.startEditing : undefined}
              onConfirmStillAccurate={canEdit && editor.status === 'idle' ? () => { void attestation.confirm(state.data.element, state.data.commitId); } : undefined}
              confirming={attestation.confirmingId === state.data.element.element_id}
              onProposeChange={canPropose ? () => { setProposingChange(true); } : undefined}
              readOnlyReason={underReview ? 'Read-only: under review' : undefined}
              interfacePlatform={
                state.data.parent && isIntegrationInterface(state.data.element, state.data.parent)
                  ? {
                      name: state.data.parent.name,
                      href: `/o/${orgSlug ?? ''}/m/${model.slug}/e/${state.data.parent.element_id}?${refQueryParam(ref, viewing)}`,
                      typeLabel: interfaceTypeLabelOf(state.data.element),
                    }
                  : undefined
              }
              rename={canEdit ? rename : undefined}
              onRetire={canEdit && (state.data.element.element_type === 'system' || state.data.element.element_type === 'container') ? () => { setRetiring(true); } : undefined}
              onRemoveFromModel={canEdit && state.data.element.element_type !== 'value_stream' && state.data.children.length === 0 ? () => { setRemovingFromModel(true); } : undefined}
              onMerge={canEdit && state.data.element.element_type !== 'value_stream' ? () => { setMerging(true); } : undefined}
              onConvertToModule={canEdit && state.data.element.element_type === 'system' && state.data.children.length === 0 ? () => { setConverting(true); } : undefined}
              onDeactivate={
                canEditValueStream && state.data.element.element_type === 'value_stream' && state.data.element.parent_id === null && attributesRecord(state.data.element.attributes).inactive !== true
                  ? () => { setDeactivatePanel('deactivate'); }
                  : undefined
              }
              onReactivate={
                canEditValueStream && state.data.element.element_type === 'value_stream' && state.data.element.parent_id === null && attributesRecord(state.data.element.attributes).inactive === true
                  ? () => { setDeactivatePanel('reactivate'); }
                  : undefined
              }
              contextHref={
                state.data.element.element_type === 'system' || state.data.element.element_type === 'container'
                  ? `/o/${orgSlug ?? ''}/m/${model.slug}/context/${state.data.element.element_id}?${refQueryParam(ref, viewing)}`
                  : undefined
              }
              startProjectHref={
                canStartProject(role) && (state.data.element.element_type === 'capability' || state.data.element.element_type === 'system' || state.data.element.element_type === 'container')
                  ? startProjectFromElementHref(`/o/${orgSlug ?? ''}/m/${model.slug}/projects`, { id: state.data.element.element_id, name: state.data.element.name })
                  : undefined
              }
            />
            {attestation.error !== null && (
              <div role="alert">
                <Text as="p" size="sm">
                  {attestation.error}
                </Text>
              </div>
            )}
            {retiring && (state.data.element.element_type === 'system' || state.data.element.element_type === 'container') && (
              <RetireAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                facts={state.data.facts}
                relationships={state.data.relationships}
                relationshipFacts={state.data.relationshipFacts}
                searchCommitId={searchCommitId ?? state.data.commitId}
                branch={editingBranch ?? PLACEHOLDER_BRANCH}
                expectedHeadCommitId={state.data.commitId}
                onRetired={() => {
                  setRetiring(false);
                  reloadAfterCommit();
                }}
                onReplacedWithNew={(newElementId) => {
                  setRetiring(false);
                  // A itself is still here, just retiring — but the new
                  // replacement is what someone doing this almost
                  // certainly wants to continue configuring next, the
                  // same "navigate to what was just created" convention
                  // `onCreated`/`onConverted`/`onMerged` all already use
                  // on this page.
                  void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/e/${newElementId}?${refQueryParam(ref, viewing)}`);
                }}
                onCancel={() => { setRetiring(false); }}
              />
            )}
            {removingFromModel && (
              <RemoveFromModelAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                facts={state.data.facts}
                relationships={state.data.relationships}
                relationshipFacts={state.data.relationshipFacts}
                relationshipEndpoints={state.data.relationshipEndpoints}
                branch={editingBranch ?? PLACEHOLDER_BRANCH}
                expectedHeadCommitId={state.data.commitId}
                onRemoved={() => {
                  setRemovingFromModel(false);
                  reloadAfterCommit();
                }}
                onCancel={() => { setRemovingFromModel(false); }}
              />
            )}
            {merging && (
              <MergeIntoAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                relationshipEndpoints={state.data.relationshipEndpoints}
                elementChildren={state.data.children}
                searchCommitId={searchCommitId ?? state.data.commitId}
                branch={editingBranch ?? PLACEHOLDER_BRANCH}
                expectedHeadCommitId={state.data.commitId}
                initialTarget={mergePrefill ? { elementId: mergePrefill.targetId, name: mergePrefill.targetName } : null}
                onMerged={(survivorId) => {
                  setMerging(false);
                  // The current element no longer exists at this ref once
                  // merged — navigate straight to the survivor rather than
                  // reloading into `notPresentAtRef`'s own empty state.
                  void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/e/${survivorId}?${refQueryParam(ref, viewing)}`);
                }}
                onCancel={() => { setMerging(false); }}
              />
            )}
            {converting && state.data.element.element_type === 'system' && (
              <ConvertToModuleAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                relationshipEndpoints={state.data.relationshipEndpoints}
                searchCommitId={searchCommitId ?? state.data.commitId}
                branch={editingBranch ?? PLACEHOLDER_BRANCH}
                expectedHeadCommitId={state.data.commitId}
                onConverted={(newContainerId) => {
                  setConverting(false);
                  // The current element no longer exists at this ref once
                  // converted — navigate straight to the new module rather
                  // than reloading into `notPresentAtRef`'s own empty state
                  // (same reasoning `onMerged` above gives).
                  void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/e/${newContainerId}?${refQueryParam(ref, viewing)}`);
                }}
                onCancel={() => { setConverting(false); }}
              />
            )}
            {deactivatePanel && state.data.element.element_type === 'value_stream' && (
              <ValueStreamDeactivateAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                facts={state.data.facts}
                branch={editingBranch ?? PLACEHOLDER_BRANCH}
                expectedHeadCommitId={state.data.commitId}
                mode={deactivatePanel}
                onChanged={() => {
                  setDeactivatePanel(null);
                  reloadAfterCommit();
                }}
                onCancel={() => { setDeactivatePanel(null); }}
              />
            )}
            {proposingChange && (
              <Panel>
                {/* Prompt pack F0: "element page → correct or propose" — a one-line toggle between the two, correct the default (see this state's own comment). */}
                <div className={styles.intentToggle ?? ''}>
                  <Button variant={proposeChangeIntent === 'correct' ? 'primary' : 'ghost'} onClick={() => { setProposeChangeIntent('correct'); }}>
                    Correct the record
                  </Button>
                  <Button variant={proposeChangeIntent === 'propose' ? 'primary' : 'ghost'} onClick={() => { setProposeChangeIntent('propose'); }}>
                    Propose a plan
                  </Button>
                </div>
                <ProposeChangePicker
                  modelId={model.id}
                  orgId={organisation?.id ?? ''}
                  userId={userId}
                  defaultDescription={`${proposeChangeIntent === 'correct' ? 'Corrects' : 'Proposes a change to'} ${state.data.element.name}`}
                  defaultIntent={proposeChangeIntent}
                  onChosen={(branch) => {
                    setProposingChange(false);
                    void navigate(`/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId ?? ''}?ref=${refParamOf({ kind: 'branch', branchId: branch.id })}`);
                  }}
                  onCancel={() => {
                    setProposingChange(false);
                  }}
                />
              </Panel>
            )}
            {justCreatedType && !toastDismissed && (
              <Panel className={styles.toast ?? ''} data-testid="add-system-toast">
                <Text as="p" size="sm">
                  {state.data.element.name} added.
                </Text>
                <div className={styles.toastActions}>
                  <Link to={`/o/${orgSlug ?? ''}/m/${model.slug}`}>
                    <Text as="span" size="sm">
                      Add another {justCreatedType} →
                    </Text>
                  </Link>
                  <Button variant="ghost" onClick={() => { setToastDismissed(true); }}>
                    Dismiss
                  </Button>
                </div>
              </Panel>
            )}
            <div className={styles.columns}>
              <div className={styles.leftColumn}>
                <CollapsibleSection title="Attributes">
                  {editor.status === 'idle' ? (
                    <AttributesTable
                      isInterface={isIntegrationInterface(state.data.element, state.data.parent)}
                      element={state.data.element}
                      facts={state.data.facts}
                      sources={state.data.sources}
                      aliases={state.data.aliases}
                      aliasSources={state.data.aliasSources}
                      customFields={customFieldsForDisplay}
                    />
                  ) : (
                    <AttributesEditor
                      element={state.data.element}
                      editor={editor}
                      aliases={state.data.aliases}
                      aliasSources={state.data.aliasSources}
                      customFields={customFieldsForEditing}
                    />
                  )}
                  {canEdit && state.data.element.element_type === 'actor' && userId && (
                    <ActorMemberPicker
                      modelId={model.id}
                      orgId={organisation?.id ?? ''}
                      userId={userId}
                      element={state.data.element}
                      facts={state.data.facts}
                      branch={editingBranch}
                      expectedHeadCommitId={state.data.commitId}
                      onSaved={reloadAfterCommit}
                    />
                  )}
                </CollapsibleSection>
                {/* An integration platform's own interfaces and flows come first after its attributes — what it exposes, and what goes through it, is what the page is for (ADR-026). */}
                {state.data.element.element_type === 'system' && isIntegrationPlatform(state.data.element) && (
                  <CollapsibleSection title="Interfaces" meta={`(${String(state.data.children.filter((c) => c.element_type === 'container').length)})`}>
                    <InterfacesSection orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} interfaces={state.data.children.filter((c) => c.element_type === 'container')} flows={state.data.flowsViaThisPlatform} />
                    {canAddRelationship && (
                      <AddInterfaceForm
                        platformId={state.data.element.element_id}
                        platformName={state.data.element.name}
                        modelId={model.id}
                        orgId={organisation?.id ?? ''}
                        userId={userId}
                        branch={editingBranch}
                        expectedHeadCommitId={state.data.commitId}
                        onCreated={reloadAfterCommit}
                      />
                    )}
                  </CollapsibleSection>
                )}
                {(isIntegrationPlatform(state.data.element) && state.data.element.element_type === 'system') || isIntegrationInterface(state.data.element, state.data.parent) ? (
                  <CollapsibleSection title={state.data.element.element_type === 'container' ? 'Flows via this interface' : 'Flows via this platform'} meta={`(${String(state.data.flowsViaThisPlatform.length)})`}>
                    <PlatformFlowsSection
                      orgSlug={organisation?.slug ?? ''}
                      modelSlug={model.slug}
                      flows={state.data.flowsViaThisPlatform}
                      endpoints={state.data.flowsViaThisPlatformEndpoints}
                      interfaces={new Map((state.data.element.element_type === 'container' ? [state.data.element] : state.data.children.filter((c) => c.element_type === 'container')).map((c) => [c.element_id, c]))}
                    />
                  </CollapsibleSection>
                ) : null}
                <CollapsibleSection title="Relationships" meta={`(${String(state.data.relationships.length)})`}>
                  <RelationshipsSection
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    elementId={state.data.element.element_id}
                    elementType={state.data.element.element_type}
                    elementName={state.data.element.name}
                    elementParentId={state.data.element.parent_id}
                    elementIsExternal={state.data.element.element_type === 'actor' && attributesRecord(state.data.element.attributes).isExternal === true}
                    isInterface={isIntegrationInterface(state.data.element, state.data.parent)}
                    relationships={state.data.relationships}
                    endpoints={state.data.relationshipEndpoints}
                    relationshipFacts={state.data.relationshipFacts}
                    sources={state.data.sources}
                    justAddedElementId={justAddedElementId}
                    addRelationship={
                      canAddRelationship
                        ? {
                            modelId: model.id,
                            orgId: organisation?.id ?? '',
                            userId,
                            elementName: state.data.element.name,
                            searchCommitId,
                            branch: editingBranch,
                            expectedHeadCommitId: state.data.commitId,
                            onCreated: (otherElementId) => {
                              setJustAddedElementId(otherElementId);
                              reloadAfterCommit();
                            },
                          }
                        : undefined
                    }
                    removeRelationship={
                      canAddRelationship
                        ? {
                            modelId: model.id,
                            orgId: organisation?.id ?? '',
                            userId,
                            branch: editingBranch,
                            expectedHeadCommitId: state.data.commitId,
                            onRemoved: reloadAfterCommit,
                          }
                        : undefined
                    }
                    editRelationship={
                      canAddRelationship
                        ? {
                            modelId: model.id,
                            orgId: organisation?.id ?? '',
                            userId,
                            branch: editingBranch,
                            expectedHeadCommitId: state.data.commitId,
                            onSaved: reloadAfterCommit,
                          }
                        : undefined
                    }
                    enablesAddRelationship={
                      canAddEnablesRelationship
                        ? {
                            modelId: model.id,
                            orgId: organisation?.id ?? '',
                            userId,
                            elementName: state.data.element.name,
                            searchCommitId,
                            branch: editingBranch,
                            expectedHeadCommitId: state.data.commitId,
                            onCreated: (otherElementId) => {
                              setJustAddedElementId(otherElementId);
                              reloadAfterCommit();
                            },
                          }
                        : undefined
                    }
                    enablesRemoveRelationship={
                      canAddEnablesRelationship
                        ? {
                            modelId: model.id,
                            orgId: organisation?.id ?? '',
                            userId,
                            branch: editingBranch,
                            expectedHeadCommitId: state.data.commitId,
                            onRemoved: reloadAfterCommit,
                          }
                        : undefined
                    }
                  />
                </CollapsibleSection>
                <CollapsibleSection title="Structure">
                  <StructureSection orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} parent={state.data.parent} capabilityLevel={state.data.capabilityLevel} children={state.data.children} />
                </CollapsibleSection>
                {state.data.element.element_type === 'value_stream' && state.data.element.parent_id === null && (
                  <CollapsibleSection title="Stages" meta={`(${String(state.data.children.length)})`}>
                    <ValueStreamStagesSection
                      orgSlug={organisation?.slug ?? ''}
                      modelSlug={model.slug}
                      stages={state.data.children}
                      reorderContext={
                        canEditValueStream
                          ? { modelId: model.id, orgId: organisation?.id ?? '', userId, branch: editingBranch, expectedHeadCommitId: state.data.commitId, onReordered: reloadAfterCommit }
                          : undefined
                      }
                    />
                    {canEditValueStream && searchCommitId ? (
                      <ElementSearchAdd
                        elementType="value_stream"
                        buttonLabel="+ Add stage"
                        parentId={state.data.element.element_id}
                        modelId={model.id}
                        orgId={organisation?.id ?? ''}
                        userId={userId}
                        searchCommitId={searchCommitId}
                        branch={editingBranch}
                        expectedHeadCommitId={state.data.commitId}
                        orgSlug={organisation?.slug ?? ''}
                        modelSlug={model.slug}
                        refParam={refParamOf(ref)}
                        onCreated={reloadAfterCommit}
                      />
                    ) : (
                      canEdit && <ValueStreamGateNotice orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
                    )}
                  </CollapsibleSection>
                )}
                {isImpactEligible && (
                  <CollapsibleSection title="Impact" meta={valueStreamImpact.status === 'ready' ? `(${String(valueStreamImpact.affected.length)})` : undefined}>
                    {valueStreamImpact.status === 'loading' && (
                      <Text as="p" tone="muted" size="sm">
                        Loading…
                      </Text>
                    )}
                    {valueStreamImpact.status === 'ready' && <ValueStreamImpactSection orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} affected={valueStreamImpact.affected} />}
                  </CollapsibleSection>
                )}
                {state.data.element.element_type === 'system' && isPlatform(state.data.element) && (
                  <CollapsibleSection title="Modules" meta={`(${String(state.data.children.length)})`}>
                    <ModulesSection
                      orgSlug={organisation?.slug ?? ''}
                      modelSlug={model.slug}
                      modules={state.data.children}
                      moduleSupportsEdges={state.data.moduleSupportsEdges}
                      moduleSupportsCapabilities={state.data.moduleSupportsCapabilities}
                    />
                    {canAddRelationship && (
                      <ElementSearchAdd
                        elementType="container"
                        buttonLabel="+ Add module"
                        parentId={state.data.element.element_id}
                        modelId={model.id}
                        orgId={organisation?.id ?? ''}
                        userId={userId}
                        searchCommitId={searchCommitId}
                        branch={editingBranch}
                        expectedHeadCommitId={state.data.commitId}
                        orgSlug={organisation?.slug ?? ''}
                        modelSlug={model.slug}
                        refParam={refParamOf(ref)}
                        onCreated={reloadAfterCommit}
                      />
                    )}
                  </CollapsibleSection>
                )}
              </div>
              <div className={styles.rightColumn}>
                <CollapsibleSection title="Changes touching this">
                  <ChangesTouchingSection inFlightBranches={state.data.inFlightBranches} />
                </CollapsibleSection>
                <CollapsibleSection title="History">
                  <HistoryTimeline
                    key={state.data.element.element_id}
                    history={state.data.history}
                    elementId={state.data.element.element_id}
                    relationshipEndpoints={state.data.relationshipEndpoints}
                    retractedElementNames={state.data.retractedElementNames}
                  />
                </CollapsibleSection>
                <CollapsibleSection title="Decisions" meta={`(${String(state.data.elementDecisions.length)})`}>
                  {/* "Why is this here" (prompt pack F3 PR6) — replaces the
                      hardcoded EmptyState Prompt 7h bug B6 left here before
                      the decisions schema existed at all. */}
                  <ElementDecisionsSection entries={state.data.elementDecisions} orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} />
                </CollapsibleSection>
                <CollapsibleSection title="Comments">
                  <CommentsSection
                    orgId={organisation?.id ?? ''}
                    modelId={model.id}
                    userId={userId}
                    role={role}
                    anchorType="element"
                    anchorId={state.data.element.element_id}
                    branchId={ref.kind === 'branch' ? (editingBranch?.id ?? null) : null}
                  />
                </CollapsibleSection>
              </div>
            </div>
          </>
        )}
        </main>
      </div>
    </div>
  );
}

const EMPTY_FACTS = new Map<string, FactsRow>();
// useElementEditor is only actually invoked (its startEditing/save reached)
// once `state.status === 'ready'` and canEdit is true; this placeholder
// only exists so the hook — which the Rules of Hooks require to run every
// render, not conditionally — always has an ElementsHeadRow to close over
// while data is still loading.
const PLACEHOLDER_ELEMENT: ElementsHeadRow = { element_id: '', element_type: 'system', name: '', parent_id: null, attributes: {}, exists_delta_id: '' };
// Same reasoning as PLACEHOLDER_ELEMENT above: the editing hooks need a
// branch to close over on every render, including before useEditingBranch has
// resolved one — canEdit gates the affordance itself, so this is never
// actually committed to.
const PLACEHOLDER_BRANCH: BranchRow = {
  id: '',
  org_id: '',
  model_id: '',
  name: '',
  kind: 'main',
  status: 'draft',
  base_commit_id: '',
  head_commit_id: '',
  shared_for_review: false,
  title: null,
  description: null,
  target_date: null,
  split_from: null,
  created_by: '',
  updated_at: '',
  cancel_reason: null,
  cancelled_at: null,
  cancelled_by: null,
  dismissed_identity_pairs: [],
  intent: null,
  project_id: null,
};

/** Sprint U4-1 D1: "alias moves into attributes" — each alias renders as its own read-only row, same shape as any other attribute (`aliasAsFact` gives `AttributeRow` a `FactsRow` to work with), labelled by its real `alias_type` (`ALIAS_TYPE_LABELS`) rather than the header's old single undifferentiated "aka" bucket. Appended after the schema-driven fields — an alias is always additional identifying information, never a substitute for one of them. */
function AliasRows({ elementId, aliases, aliasSources }: { elementId: UUID; aliases: AliasRow[]; aliasSources: Map<UUID, SourceRow> }) {
  return (
    <>
      {aliases.map((alias) => {
        const fact = aliasAsFact(alias, elementId);
        return <AttributeRow key={alias.id} label={ALIAS_TYPE_LABELS[alias.alias_type]} required={false} fact={fact} source={aliasSources.get(alias.source_id)} />;
      })}
    </>
  );
}

function AttributesTable({
  isInterface,
  element,
  facts,
  sources,
  aliases,
  aliasSources,
  customFields,
}: {
  /** ADR-026: an interface always shows its Interface type and Transformation rows (an em dash when empty), so a missing one reads as "not filled in yet" rather than absent. */
  isInterface: boolean;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  sources: Map<string, SourceRow>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
  /** F1 ("custom attributes") PR3: this org's own definitions applying to `element.element_type`, already resolved by the caller to whichever set (non-deprecated, plus any deprecated-but-valued) belongs in a read-only view — rendered after the core schema, exactly like a core field. */
  customFields: AttributeFieldSchema[];
}) {
  // Sprint U4-1 D2: `hidden` fields (Capability.templateRef) never show
  // in the read-only list either — its own information still surfaces,
  // reworded, on a seeded fact's provenance card instead
  // (ProvenanceCard.tsx's `seededFrom`).
  const schema = ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type].filter((field) => field.hidden !== true);
  return (
    <div>
      {[...schema, ...customFields].map((field) => {
        const fact = facts.get(field.key);
        // ADR-020: `hideWhenEmpty` (Capability.code/"Reference") omits the
        // row entirely rather than rendering AttributeRow's own bare "—"
        // — distinct from `hidden` above, which excludes it regardless of
        // whether a fact exists.
        if (field.hideWhenEmpty === true && !fact && !(isInterface && (field.key === 'interfaceType' || field.key === 'transformation'))) return null;
        return <AttributeRow key={field.key} label={field.label} required={field.required} fact={fact} source={fact ? sources.get(fact.source_id) : undefined} field={field} />;
      })}
      <AliasRows elementId={element.element_id} aliases={aliases} aliasSources={aliasSources} />
    </div>
  );
}

function AttributesEditor({
  element,
  editor,
  aliases,
  aliasSources,
  customFields,
}: {
  element: ElementsHeadRow;
  editor: ReturnType<typeof useElementEditor>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
  /** F1 PR3: non-deprecated only — a deprecated definition never re-appears in the edit form's own field list, whether or not this element already has a value under it (see this file's own `customFieldsForEditing` comment). */
  customFields: AttributeFieldSchema[];
}) {
  const schema = ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type].filter((field) => field.editable !== false);
  return (
    <div>
      {[...schema, ...customFields].map((field) => (
        <AttributeEditRow
          key={field.key}
          field={field}
          value={editor.values[field.key] ?? ''}
          onChange={(value: DraftValue) => {
            editor.setValue(field.key, value);
          }}
          error={editor.fieldErrors[field.key]}
        />
      ))}
      {/* Not editable here (this hook only ever writes attributes.*, never
          the separate aliases table) — still shown, read-only, so an
          alias doesn't visibly disappear the moment someone clicks Edit. */}
      <AliasRows elementId={element.element_id} aliases={aliases} aliasSources={aliasSources} />
      {editor.submitError !== null && (
        <Text as="p" tone="default">
          {editor.submitError}
        </Text>
      )}
      <div className={styles.editorActions}>
        <Button variant="secondary" onClick={() => void editor.save()} disabled={editor.status === 'submitting' || !editor.hasChanges}>
          {editor.status === 'submitting' ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={editor.cancelEditing} disabled={editor.status === 'submitting'}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
