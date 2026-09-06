import { useParams, useSearchParams } from 'react-router';
import { ATTRIBUTE_SCHEMA_BY_TYPE } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import type { SourceRow } from '../../db/types';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { AttributeEditRow } from '../components/AttributeEditRow/AttributeEditRow';
import { AttributeRow } from '../components/AttributeRow/AttributeRow';
import { Button } from '../components/Button/Button';
import { ChangesTouchingSection } from '../components/ChangesTouchingSection/ChangesTouchingSection';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { ElementHeader } from '../components/ElementHeader/ElementHeader';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { HistoryTimeline } from '../components/HistoryTimeline/HistoryTimeline';
import { Panel } from '../components/Panel/Panel';
import { RelationshipsSection } from '../components/RelationshipGroup/RelationshipsSection';
import { StructureSection } from '../components/StructureSection/StructureSection';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useModels } from '../models/useModels';
import { canEditOnMain, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { parseRefParam } from '../../db/ref';
import { useElementPage } from '../elements/useElementPage';
import { useElementEditor, type DraftValue } from '../elements/useElementEditor';
import styles from './ElementPage.module.css';

/**
 * The element page (UI-principles.md §4) — the product's unit of trust.
 * Attributes with provenance badges, relationships grouped by type, and
 * designed empty states are the three things Sprint U1 step 3 named
 * explicitly; structure and history come from the same materialised data
 * at no extra cost. Sprint U1 step 5 makes `Edit` (§4.2) real: owner/
 * architect, at `main`, editing attribute values — see
 * src/ui/elements/useElementEditor.ts for what that does and doesn't cover
 * yet. Decisions and comments have no backing table yet (`decisions`/
 * `comments` — deferred to Sprints D1/M1, per the user's own step 3a
 * decision) and say so plainly rather than rendering SPEC's designed
 * empty-state copy for a feature that doesn't exist yet.
 */
export function ElementPage() {
  const { orgSlug, modelSlug, elementId } = useParams<{ orgSlug: string; modelSlug: string; elementId: string }>();
  const [searchParams] = useSearchParams();
  const ref = parseRefParam(searchParams.get('ref'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const { role } = useMembership(organisation?.id ?? null, userId);

  const { state, reload } = useElementPage(model?.id ?? '', elementId ?? '', ref);
  const canEdit = ref.kind === 'main' && canEditOnMain(role);

  const data = state.status === 'ready' ? state.data : null;
  const editor = useElementEditor({
    modelId: model?.id ?? '',
    orgId: organisation?.id ?? '',
    userId,
    element: data?.element ?? PLACEHOLDER_ELEMENT,
    facts: data?.facts ?? EMPTY_FACTS,
    expectedHeadCommitId: data?.commitId ?? '',
    onSaved: reload,
  });

  if (orgLoading || modelsLoading || !model) {
    return (
      <div>
        <AppHeader />
        <main className={styles.main}>
          <Text tone="muted">Loading…</Text>
        </main>
      </div>
    );
  }

  return (
    <div>
      <AppHeader />
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
            <ElementHeader
              element={state.data.element}
              existsFact={state.data.facts.get('$exists')}
              existsSource={state.data.sources.get(state.data.facts.get('$exists')?.source_id ?? '')}
              aliases={state.data.aliases}
              aliasSources={state.data.aliasSources}
              onEdit={canEdit && editor.status === 'idle' ? editor.startEditing : undefined}
            />
            <div className={styles.columns}>
              <div className={styles.leftColumn}>
                <CollapsibleSection title="Attributes">
                  {editor.status === 'idle' ? (
                    <AttributesTable element={state.data.element} facts={state.data.facts} sources={state.data.sources} />
                  ) : (
                    <AttributesEditor element={state.data.element} editor={editor} />
                  )}
                </CollapsibleSection>
                <CollapsibleSection title="Relationships" meta={`(${String(state.data.relationships.length)})`}>
                  <RelationshipsSection
                    orgSlug={organisation?.slug ?? ''}
                    modelSlug={model.slug}
                    elementId={state.data.element.element_id}
                    relationships={state.data.relationships}
                    endpoints={state.data.relationshipEndpoints}
                    relationshipFacts={state.data.relationshipFacts}
                    sources={state.data.sources}
                  />
                </CollapsibleSection>
                <CollapsibleSection title="Structure">
                  <StructureSection orgSlug={organisation?.slug ?? ''} modelSlug={model.slug} parent={state.data.parent} children={state.data.children} />
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
  );
}

const EMPTY_FACTS = new Map<string, FactsRow>();
// useElementEditor is only actually invoked (its startEditing/save reached)
// once `state.status === 'ready'` and canEdit is true; this placeholder
// only exists so the hook — which the Rules of Hooks require to run every
// render, not conditionally — always has an ElementsHeadRow to close over
// while data is still loading.
const PLACEHOLDER_ELEMENT: ElementsHeadRow = { element_id: '', element_type: 'system', name: '', parent_id: null, attributes: {}, exists_delta_id: '' };

function AttributesTable({ element, facts, sources }: { element: ElementsHeadRow; facts: Map<string, FactsRow>; sources: Map<string, SourceRow> }) {
  const schema = ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type];
  return (
    <div>
      {schema.map((field) => {
        const fact = facts.get(field.key);
        return <AttributeRow key={field.key} label={field.label} required={field.required} fact={fact} source={fact ? sources.get(fact.source_id) : undefined} />;
      })}
    </div>
  );
}

function AttributesEditor({ element, editor }: { element: ElementsHeadRow; editor: ReturnType<typeof useElementEditor> }) {
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
