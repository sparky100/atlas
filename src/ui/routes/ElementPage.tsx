import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ATTRIBUTE_SCHEMA_BY_TYPE } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { AliasRow, BranchRow, SourceRow } from '../../db/types';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { AttributeEditRow } from '../components/AttributeEditRow/AttributeEditRow';
import { AttributeRow } from '../components/AttributeRow/AttributeRow';
import { Breadcrumb } from '../components/Breadcrumb/Breadcrumb';
import { Button } from '../components/Button/Button';
import { CapabilityRetractAction } from '../components/CapabilityRetractAction/CapabilityRetractAction';
import { ChangesTouchingSection } from '../components/ChangesTouchingSection/ChangesTouchingSection';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementHeader } from '../components/ElementHeader/ElementHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { HistoryTimeline } from '../components/HistoryTimeline/HistoryTimeline';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Panel } from '../components/Panel/Panel';
import { RelationshipsSection } from '../components/RelationshipGroup/RelationshipsSection';
import { StructureSection } from '../components/StructureSection/StructureSection';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { useModels } from '../models/useModels';
import { canEditBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam, refLabelOf, refParamOf } from '../../db/ref';
import { elementBreadcrumbSegments } from '../nav/elementBreadcrumbSegments';
import { ALIAS_TYPE_LABELS, aliasAsFact } from '../elements/aliasLabels';
import { useElementPage } from '../elements/useElementPage';
import { useElementEditor, type DraftValue } from '../elements/useElementEditor';
import { useElementRename } from '../elements/useElementRename';
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
 * (and `useElementRetract`/`useElementRename`/`CapabilityRetractAction`,
 * the latter renamed from `CapabilityTailoringActions` in Sprint U4-1 D3)
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
  const ref = parseRefParam(searchParams.get('ref'));
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

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);

  const { state, reload } = useElementPage(model?.id ?? '', elementId ?? '', ref);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  const canEdit = editingBranch !== null && canEditBranch(role, editingBranch);
  // See LandscapePage.tsx's identical comment: ADR-018 guarantees main's
  // head is never null in practice; `BranchRow`'s own type hasn't been
  // narrowed yet. `expectedHeadCommitId` for the relationship-add write
  // itself reuses `state.data.commitId`, already established below.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const canAddRelationship = canEdit && searchCommitId !== null;

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
  const editor = useElementEditor({
    modelId: model?.id ?? '',
    orgId: organisation?.id ?? '',
    userId,
    element: data?.element ?? PLACEHOLDER_ELEMENT,
    facts: data?.facts ?? EMPTY_FACTS,
    branch: editingBranch ?? PLACEHOLDER_BRANCH,
    expectedHeadCommitId: data?.commitId ?? '',
    onSaved: reloadAfterCommit,
  });
  // Sprint U4-1 D3: called unconditionally, same reasoning as `editor`
  // above (the Rules of Hooks) — only actually offered to
  // ElementHeader.tsx (its `rename` prop) once `canEdit` and the element
  // is a capability, the same gate `CapabilityRetractAction.tsx`'s own
  // former bundling with rename already used.
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
        <AppHeader />
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
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main className={styles.main}>
        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'notPresentAtRef' && (
          <Panel>
            <Text as="p" tone="muted">
              This element is not present at the current ref. It may have been retracted, or never existed here.
            </Text>
          </Panel>
        )}
        {state.status === 'ready' && (
          <>
            <Breadcrumb
              org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
              model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
              refLabel={refLabelOf(ref)}
              segments={elementBreadcrumbSegments(state.data.element, state.data.parent, orgSlug ?? '', model.slug, refParamOf(ref))}
            />
            <ElementHeader
              element={state.data.element}
              existsFact={state.data.facts.get('$exists')}
              existsSource={state.data.sources.get(state.data.facts.get('$exists')?.source_id ?? '')}
              onEdit={canEdit && editor.status === 'idle' ? editor.startEditing : undefined}
              rename={canEdit && state.data.element.element_type === 'capability' ? rename : undefined}
            />
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
            {canEdit && state.data.element.element_type === 'capability' && (
              <CapabilityRetractAction
                modelId={model.id}
                orgId={organisation?.id ?? ''}
                userId={userId}
                element={state.data.element}
                facts={state.data.facts}
                branch={editingBranch}
                expectedHeadCommitId={state.data.commitId}
                canRetract={state.data.children.length === 0 && state.data.relationships.length === 0}
                onChanged={reloadAfterCommit}
              />
            )}
            <div className={styles.columns}>
              <div className={styles.leftColumn}>
                <CollapsibleSection title="Attributes">
                  {editor.status === 'idle' ? (
                    <AttributesTable
                      element={state.data.element}
                      facts={state.data.facts}
                      sources={state.data.sources}
                      aliases={state.data.aliases}
                      aliasSources={state.data.aliasSources}
                    />
                  ) : (
                    <AttributesEditor element={state.data.element} editor={editor} aliases={state.data.aliases} aliasSources={state.data.aliasSources} />
                  )}
                </CollapsibleSection>
                <CollapsibleSection title="Relationships" meta={`(${String(state.data.relationships.length)})`}>
                  <RelationshipsSection
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    elementId={state.data.element.element_id}
                    elementType={state.data.element.element_type}
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
                  />
                </CollapsibleSection>
                <CollapsibleSection title="Structure">
                  <StructureSection orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} parent={state.data.parent} capabilityLevel={state.data.capabilityLevel} children={state.data.children} />
                </CollapsibleSection>
              </div>
              <div className={styles.rightColumn}>
                <CollapsibleSection title="Changes touching this">
                  <ChangesTouchingSection inFlightBranches={state.data.inFlightBranches} />
                </CollapsibleSection>
                <CollapsibleSection title="History">
                  <HistoryTimeline history={state.data.history} />
                </CollapsibleSection>
                <CollapsibleSection title="Decisions">
                  <EmptyState>Decisions aren't built yet — see Sprint D1.</EmptyState>
                </CollapsibleSection>
                <CollapsibleSection title="Comments">
                  <EmptyState>Comments aren't built yet — see Sprint M1.</EmptyState>
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
  element,
  facts,
  sources,
  aliases,
  aliasSources,
}: {
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  sources: Map<string, SourceRow>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
}) {
  // Sprint U4-1 D2: `hidden` fields (Capability.templateRef) never show
  // in the read-only list either — its own information still surfaces,
  // reworded, on a seeded fact's provenance card instead
  // (ProvenanceCard.tsx's `seededFrom`).
  const schema = ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type].filter((field) => field.hidden !== true);
  return (
    <div>
      {schema.map((field) => {
        const fact = facts.get(field.key);
        return <AttributeRow key={field.key} label={field.label} required={field.required} fact={fact} source={fact ? sources.get(fact.source_id) : undefined} />;
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
}: {
  element: ElementsHeadRow;
  editor: ReturnType<typeof useElementEditor>;
  aliases: AliasRow[];
  aliasSources: Map<UUID, SourceRow>;
}) {
  const schema = ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type].filter((field) => field.editable !== false);
  return (
    <div>
      {schema.map((field) => (
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
