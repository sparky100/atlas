import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ElementType, UUID } from '../../contracts/delta';
import type { Json } from '../../contracts/rows';
import { refParamOf, type Ref } from '../../db/ref';
import type { BranchRow, MemberRole } from '../../db/types';
import { useElementCreate } from '../elements/useElementCreate';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { attributesRecord } from '../elements/attributesRecord';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { canCreateChangeBranch, canEditOnMain } from '../orgs/useMembership';
import { CapabilitySupportsPicker } from './CapabilitySupportsPicker';
import { ProposeChangePicker } from './ProposeChangePicker';
import { HOME_SEARCH_CREATABLE_TYPES, useHomeSearch } from './useHomeSearch';
import styles from './HomeSearch.module.css';

export interface HomeSearchProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  /** Always main's real head — search never varies with the ref (src/db/elementSearch.ts's own module comment; Handoff — Flow: Add a system's own "Search does not change with the branch"). */
  searchCommitId: UUID;
  /** The current front-door ref (Handoff — Flow: Add a system, decision 5: "create follows the active ref") — `main` unless the door is opened at `?ref=branch:…`. */
  activeRef: Ref;
  /** `useEditingBranch(modelId, ref)`'s own resolution, from the caller — `null` while loading or for a ref with no editable branch (a tag). */
  editingBranch: BranchRow | null;
  orgSlug: string;
  modelSlug: string;
  /** Handoff — Flow: Add a system, decision 2: on, only for the architect door — the caller decides, this control just obeys. */
  autoFocus?: boolean;
}

/**
 * Both front doors' search box (UI-principles §3 + the U3b brief: "a search
 * box (search-first) that opens or creates an element"). Always open —
 * unlike `ElementSearchAdd` (a per-page "+ Add", closed until clicked),
 * this *is* the front door's own content, not an auxiliary control tucked
 * behind a button. Searches every top-level-creatable type at once
 * (`useHomeSearch.ts`); once nothing matches, picking a type is what
 * `ElementSearchAdd` doesn't need (it's always fixed to one type by the
 * page it's on) and this control does, since a home-page search has no
 * such fixed context.
 *
 * Handoff — Flow: Add a system: the `system` create path additionally asks
 * a required description and an optional "supports which capability" before
 * committing (decisions 7/8) — `capability`/`actor` keep the plainer
 * immediate-create this control always had, since the flow's own required-
 * description reasoning ("what stops the model filling with named systems
 * nobody can describe") is system-specific and `actor` has no description
 * attribute to require (`attributeSchema.ts`'s `ACTOR_ORDER`). Decision 5's
 * branch handling (active ref, propose-a-change for a contributor at main)
 * applies to every type this control creates, not system alone.
 */
export function HomeSearch({ modelId, orgId, userId, role, searchCommitId, activeRef, editingBranch, orgSlug, modelSlug, autoFocus }: HomeSearchProps) {
  const navigate = useNavigate();
  const search = useHomeSearch(searchCommitId, modelId);
  const [createType, setCreateType] = useState<ElementType>('system');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [capability, setCapability] = useState<{ id: UUID; name: string } | null>(null);
  const [proposedBranch, setProposedBranch] = useState<BranchRow | null>(null);
  // Bug fix: this used to hardcode `?ref=main` — an *existing* element
  // found by search always lives on main (search itself never varies
  // with the ref, this component's own doc comment), but opening it
  // still needs to carry the session's own selected ref forward, or the
  // very next edit made from that element page silently targets main
  // instead of the change the reviewer had open a moment ago.
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${refParamOf(activeRef)}`;

  // Decision 5: a contributor viewing main has no direct write to main
  // (roleGates.ts's canEditOnMain) — they get the propose-a-change picker
  // instead of a write target, until they resolve one.
  const contributorAtMain = activeRef.kind === 'main' && !canEditOnMain(role) && canCreateChangeBranch(role);
  const writeBranch = contributorAtMain ? proposedBranch : editingBranch;

  const resetSheet = () => {
    setSheetOpen(false);
    setDescription('');
    setCapability(null);
  };

  const { status: createStatus, error: createError, create } = useElementCreate({
    modelId,
    orgId,
    userId,
    elementType: createType,
    parentId: null,
    branch: writeBranch ?? PLACEHOLDER_BRANCH,
    expectedHeadCommitId: writeBranch?.head_commit_id ?? '',
    onCreated: (elementId) => {
      resetSheet();
      // The new element lives wherever it was actually written (main, or
      // the change branch just proposed/selected) — not always main, unlike
      // an existing match found by search (which is always on main).
      const createdRef = writeBranch?.kind === 'change' ? refParamOf({ kind: 'branch', branchId: writeBranch.id }) : 'main';
      void navigate(`/o/${orgSlug}/m/${modelSlug}/e/${elementId}?ref=${createdRef}`, { state: { justCreated: createType } });
    },
  });

  const showDescriptionSheet = createType === 'system';

  const submitCreate = () => {
    const attributes: Record<string, Json> = showDescriptionSheet && description.trim().length > 0 ? { description: description.trim() } : {};
    void create(search.query, { attributes, ...(capability ? { supportsCapabilityId: capability.id, supportsCapabilityName: capability.name } : {}) });
  };

  return (
    <div className={styles.panel}>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in per caller (decision 2: architect door only); a home page that never wants it simply omits the prop.
        autoFocus={autoFocus}
        type="text"
        className={styles.input}
        placeholder="Search or create a capability, system, or actor…"
        value={search.query}
        onChange={(e) => {
          search.setQuery(e.target.value);
        }}
      />

      {activeRef.kind === 'branch' && (
        <Text as="p" tone="faint" size="xs">
          Searched against main&rsquo;s head, not this branch.
        </Text>
      )}

      {search.status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      )}
      {search.status === 'error' && (
        <Text as="p" size="sm">
          {search.error}
        </Text>
      )}

      {search.results.length > 0 && (
        <ul className={styles.results}>
          {search.results.map((result) => {
            const lifecycleStatus = attributesRecord(result.element.attributes).lifecycleStatus;
            const tone = typeof lifecycleStatus === 'string' ? lifecycleToneFor(lifecycleStatus) : undefined;
            return (
              <li key={result.element.element_id}>
                <Link to={elementHref(result.element.element_id)} className={styles.resultRow}>
                  <ElementTypeGlyph type={result.element.element_type} />
                  <Text as="span">{result.element.name}</Text>
                  <Text as="span" tone="muted" size="sm">
                    {result.element.element_type}
                    {result.owner ? ` · ${result.owner.name}` : ''} · {result.relationshipCount} relationship{result.relationshipCount === 1 ? '' : 's'}
                  </Text>
                  {tone && typeof lifecycleStatus === 'string' && <Chip tone={tone}>{lifecycleStatus}</Chip>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {search.showCreate && !sheetOpen && canCreateChangeBranch(role) && (
        <div className={styles.createRow}>
          <select
            className={styles.select}
            value={createType}
            onChange={(e) => {
              setCreateType(e.target.value as ElementType);
            }}
          >
            {HOME_SEARCH_CREATABLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            onClick={() => {
              // Every path needs at least a resolved write branch; `system`
              // additionally needs the description/capability sheet — both
              // gate through `sheetOpen` so there is exactly one place
              // (below) that decides what to show next.
              if (showDescriptionSheet || (contributorAtMain && !proposedBranch)) setSheetOpen(true);
              else void create(search.query);
            }}
          >
            Create {createType} &quot;{search.query.trim()}&quot;
          </Button>
        </div>
      )}

      {search.showCreate && sheetOpen && contributorAtMain && !proposedBranch && (
        <ProposeChangePicker
          modelId={modelId}
          orgId={orgId}
          userId={userId}
          onChosen={(branch) => {
            setProposedBranch(branch);
            // A type with no description sheet of its own (capability,
            // actor) is ready to create the moment a write branch exists.
            if (!showDescriptionSheet) void create(search.query);
          }}
          onCancel={resetSheet}
        />
      )}

      {search.showCreate && sheetOpen && showDescriptionSheet && (!contributorAtMain || proposedBranch) && (
        <div className={styles.sheet} data-testid="add-system-sheet">
          {writeBranch?.kind === 'change' && (
            <Text as="p" tone="muted" size="sm">
              Adding to change: {writeBranch.title ?? writeBranch.name}
            </Text>
          )}
          <Text as="label" size="sm">
            Description (required)
          </Text>
          <input
            type="text"
            className={styles.input}
            placeholder="One line — what this system is"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
          <Text as="label" size="sm">
            Supports which capability?
          </Text>
          <CapabilitySupportsPicker
            commitId={searchCommitId}
            modelId={modelId}
            selectedName={capability?.name ?? null}
            onSelect={(id, name) => {
              setCapability({ id, name });
            }}
          />
          <Text as="p" tone="faint" size="xs">
            Written as manual · {userId ? 'you' : 'signed-in user'} · confidence 1.00. Lifecycle and External default —
            {writeBranch?.kind === 'main' ? ' defaulted on create · active on main.' : ' defaulted on create · planned on a change branch.'}
          </Text>
          <div className={styles.actions}>
            <Button variant="primary" disabled={createStatus === 'creating' || description.trim().length === 0} onClick={submitCreate}>
              {createStatus === 'creating' ? 'Creating…' : 'Create'}
            </Button>
            {capability === null && (
              <Button variant="secondary" disabled={createStatus === 'creating' || description.trim().length === 0} onClick={submitCreate}>
                Skip capability
              </Button>
            )}
            <Button variant="ghost" onClick={resetSheet} disabled={createStatus === 'creating'}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {createError !== null && (
        <Text as="p" size="sm">
          {createError}
        </Text>
      )}
    </div>
  );
}

// useElementCreate needs a BranchRow to close over on every render, including
// before writeBranch has resolved (contributor-at-main, or editingBranch
// still loading) — every create path above only fires `create()` once
// `writeBranch` (via `proposedBranch`/`editingBranch`) is real, so this is
// never actually committed to. Same pattern as ElementPage.tsx's own
// PLACEHOLDER_BRANCH.
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
};
