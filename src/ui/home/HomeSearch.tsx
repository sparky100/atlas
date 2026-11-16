import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AI_AUTONOMY_HELP, AI_AUTONOMY_LABELS, AI_AUTONOMY_OPTIONS, AI_USE_HELP, AI_USE_LABELS, AI_USE_OPTIONS } from '../../contracts/attributeSchema';
import type { AiAutonomy, AiUse, ElementType, UUID } from '../../contracts/delta';
import type { Json } from '../../contracts/rows';
import { refParamOf, type Ref } from '../../db/ref';
import type { BranchRow, MemberRole } from '../../db/types';
import { useElementCreate } from '../elements/useElementCreate';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { moduleDisplayName } from '../elements/moduleDisplayName';
import { useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import { attributesRecord } from '../elements/attributesRecord';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../components/Text/Text';
import { canCreateChangeBranch, canEditOnMain } from '../orgs/useMembership';
import { defaultIntentForEntryPoint } from '../changes/branchIntent';
import { CapabilitySupportsPicker } from './CapabilitySupportsPicker';
import { ProposeChangePicker } from './ProposeChangePicker';
import { HOME_SEARCH_TYPES } from './homeSearchTypes';
import { useHomeSearch } from './useHomeSearch';
import styles from './HomeSearch.module.css';

// A container has no other element to naturally exclude from its own
// platform picker (unlike `useRelationshipTargetSearch`'s usual caller,
// relating one *existing* element to another) — same "no real element to
// exclude" sentinel `DecisionLinkPicker.tsx` already uses for the identical
// reason.
const NO_EXCLUSION: UUID = '00000000-0000-0000-0000-000000000000';

export interface HomeSearchProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  /** Always main's real head (src/db/elementSearch.ts's own module comment; Handoff — Flow: Add a system's own "Search does not change with the branch") — `editingBranch`'s own head is additionally overlaid onto this when it's a change (`useHomeSearch`'s own `branchCommitId`), so search still doesn't drift with someone else's branch, only with the one this session is actually writing to. */
  searchCommitId: UUID;
  /** The current front-door ref (Handoff — Flow: Add a system, decision 5: "create follows the active ref") — `main` unless the door is opened at `?ref=branch:…`. */
  activeRef: Ref;
  /** `useEditingBranch(modelId, ref)`'s own resolution, from the caller — `null` while loading or for a ref with no editable branch (a tag). */
  editingBranch: BranchRow | null;
  orgSlug: string;
  modelSlug: string;
  /** Handoff — Flow: Add a system, decision 2: on, only for the architect door — the caller decides, this control just obeys. */
  autoFocus?: boolean;
  /** Bumped by the Get started checklist's "Add application" button: switch the create type to system, focus the box and say what to do. 0 = never asked. */
  addApplicationRequest?: number;
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
 * nobody can describe") is system-specific; an actor *can* carry a
 * description too (`attributeSchema.ts`'s `ACTOR_ORDER`), it's just never
 * required at creation the way a system's is. `container` has its own
 * required step too — `showPlatformPicker`'s own sheet, a
 * search-and-pick for which system this is a module of (ADR-001: a
 * container's `parentId` can never be null) — reusing the same "search for
 * the target system, no kind restriction" shape `ConvertToModuleAction.tsx`
 * already establishes for the identical question asked a different way.
 * Decision 5's branch handling (active ref, propose-a-change for a
 * contributor at main) applies to every type this control creates, not
 * system alone.
 */
export function HomeSearch({ modelId, orgId, userId, role, searchCommitId, activeRef, editingBranch, orgSlug, modelSlug, autoFocus, addApplicationRequest = 0 }: HomeSearchProps) {
  const navigate = useNavigate();
  // Folds and overlays `editingBranch`'s own head onto the main-scoped pool
  // (`useHomeSearch`'s own `branchCommitId` doc comment) — an element added
  // or edited earlier in *this* change is findable again from Home search
  // without waiting for a merge.
  const search = useHomeSearch(searchCommitId, modelId, editingBranch?.kind === 'change' ? editingBranch.head_commit_id : null);
  const [createType, setCreateType] = useState<ElementType>('system');
  const [sheetOpen, setSheetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [addingApplication, setAddingApplication] = useState(false);
  const [seenRequest, setSeenRequest] = useState(addApplicationRequest);
  // A new request from the checklist's button: adjust state during render (not in an effect), then move focus below.
  if (seenRequest !== addApplicationRequest) {
    setSeenRequest(addApplicationRequest);
    setCreateType('system');
    setAddingApplication(true);
  }

  useEffect(() => {
    if (addApplicationRequest === 0) return;
    inputRef.current?.scrollIntoView({ block: 'center' });
    inputRef.current?.focus();
  }, [addApplicationRequest]);
  const [description, setDescription] = useState('');
  const [capability, setCapability] = useState<{ id: UUID; name: string } | null>(null);
  // Blank means "not an AI agent" (the attribute is simply left off, never stored as an empty value).
  const [aiAutonomy, setAiAutonomy] = useState<AiAutonomy | ''>('');
  const [aiUse, setAiUse] = useState<AiUse | ''>('');
  const [platform, setPlatform] = useState<{ id: UUID; name: string } | null>(null);
  const [proposedBranch, setProposedBranch] = useState<BranchRow | null>(null);
  // Bug fix: this used to hardcode `?ref=main` — a result found by search
  // is almost always on main (search itself doesn't vary with the ref for
  // anyone else's additions), but opening it still needs to carry the
  // session's own selected ref forward, or the very next edit made from
  // that element page silently targets main instead of the change the
  // reviewer had open a moment ago. It matters even more now that a result
  // can itself be one of this change's own overlaid elements (`search`'s
  // own `branchCommitId` above) — that element genuinely only exists on
  // `activeRef`, never on main at all yet.
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
    setAiAutonomy('');
    setAiUse('');
    setPlatform(null);
  };

  const showPlatformPicker = createType === 'container';
  // Every other creatable type is top-level (ADR-001: `parentId` null) —
  // only a container needs one, and only once `platform` is actually
  // chosen (`showPlatformPicker`'s own sheet below gates `create` on that).
  const parentId = showPlatformPicker ? (platform?.id ?? null) : null;
  const platformSearch = useRelationshipTargetSearch(
    searchCommitId,
    modelId,
    ['system'],
    NO_EXCLUSION,
    showPlatformPicker && sheetOpen && platform === null,
    writeBranch?.kind === 'change' ? writeBranch.head_commit_id : null,
  );

  const { status: createStatus, error: createError, create } = useElementCreate({
    modelId,
    orgId,
    userId,
    elementType: createType,
    parentId,
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
    if (showDescriptionSheet && aiAutonomy !== '') attributes.aiAutonomy = aiAutonomy;
    if (showDescriptionSheet && aiUse !== '') attributes.aiUse = aiUse;
    void create(search.query, { attributes, ...(capability ? { supportsCapabilityId: capability.id, supportsCapabilityName: capability.name } : {}) });
  };

  return (
    <div className={styles.panel}>
      <input
        ref={inputRef}
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

      {addingApplication && search.query.trim() === '' && (
        <Text as="p" tone="muted" size="sm">
          Type the application&apos;s name. Atlas checks the applications and modules you already have before it lets you create a new one.
        </Text>
      )}

      {search.sameNameModules.length > 0 && (
        <div role="note" aria-label="Same-named modules">
          {search.sameNameModules.map((m) => (
            <Text as="p" size="sm" key={m.element.element_id}>
              A module with this name already exists:{' '}
              <Link to={elementHref(m.element.element_id)}>{moduleDisplayName(m.element, m.parent)}</Link>. Open it, or carry on to create a separate {createType} with the same name.
            </Text>
          ))}
        </div>
      )}

      {activeRef.kind === 'branch' && (
        <Text as="p" tone="faint" size="xs">
          Searched against main and this change — not anyone else&apos;s.
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
        <ul className={styles.results} aria-label="Search results">
          {search.results.map((result) => {
            const lifecycleStatus = attributesRecord(result.element.attributes).lifecycleStatus;
            const tone = typeof lifecycleStatus === 'string' ? lifecycleToneFor(lifecycleStatus) : undefined;
            return (
              <li key={result.element.element_id}>
                <Link to={elementHref(result.element.element_id)} className={styles.resultRow}>
                  <ElementTypeGlyph type={result.element.element_type} />
                  {/* "Platform · Module" (moduleDisplayName) — the one shared naming convention every surface that can show a container uses, so a short, commonly-reused module name ("FI", "API Gateway") never reads as ambiguous or out of context. */}
                  <Text as="span">{moduleDisplayName(result.element, result.parent)}</Text>
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

      {search.moreCount > 0 && (
        <Text as="p" tone="muted" size="sm">
          {search.results.length} shown — {search.moreCount} more match{search.moreCount === 1 ? '' : 'es'}. Keep typing to narrow before creating a new one.
        </Text>
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
            {HOME_SEARCH_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            onClick={() => {
              // Every path needs at least a resolved write branch; `system`
              // additionally needs the description/capability sheet,
              // `container` its own platform picker — every extra step
              // gates through `sheetOpen` so there is exactly one place
              // (below) that decides what to show next.
              if (showDescriptionSheet || showPlatformPicker || (contributorAtMain && !proposedBranch)) setSheetOpen(true);
              else void create(search.query);
            }}
          >
            Create {createType} &quot;{search.query.trim()}&quot;
          </Button>
          {/* This path skips straight to `create()` with no sheet of its own
              (capability/actor, an already-resolved write branch) — the only
              chance to say this before it's committed. `elementSearch.ts`'s
              own module comment explains why creating on a change is
              invisible to search, for anyone, until it merges. */}
          {writeBranch?.kind === 'change' && (
            <Text as="p" tone="faint" size="xs">
              Won&apos;t be found by search until this change merges.
            </Text>
          )}
        </div>
      )}

      {search.showCreate && sheetOpen && contributorAtMain && !proposedBranch && (
        <ProposeChangePicker
          modelId={modelId}
          orgId={orgId}
          userId={userId}
          defaultIntent={defaultIntentForEntryPoint('homeSearch')}
          onChosen={(branch) => {
            setProposedBranch(branch);
            // A type with no further sheet of its own (capability, actor)
            // is ready to create the moment a write branch exists; `system`
            // and `container` still have their own required step next.
            if (!showDescriptionSheet && !showPlatformPicker) void create(search.query);
          }}
          onCancel={resetSheet}
        />
      )}

      {search.showCreate && sheetOpen && showDescriptionSheet && (!contributorAtMain || proposedBranch) && (
        <div className={styles.sheet} data-testid="add-system-sheet">
          {writeBranch?.kind === 'change' && (
            <>
              <Text as="p" tone="muted" size="sm">
                Adding to change: {writeBranch.title ?? writeBranch.name}
              </Text>
              <Text as="p" tone="faint" size="xs">
                Won&apos;t be found by search until this change merges.
              </Text>
            </>
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
          <Text as="label" size="sm">
            Is it an AI agent?
          </Text>
          <select
            className={styles.select}
            aria-label="AI agent: how it acts"
            value={aiAutonomy}
            onChange={(e) => {
              setAiAutonomy(e.target.value as AiAutonomy | '');
            }}
          >
            <option value="">Not an AI agent</option>
            {AI_AUTONOMY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {AI_AUTONOMY_LABELS[option] ?? option}
              </option>
            ))}
          </select>
          <Text as="p" tone="faint" size="xs">
            {AI_AUTONOMY_HELP}
          </Text>
          <Text as="label" size="sm">
            Does it use AI?
          </Text>
          <select
            className={styles.select}
            aria-label="Uses AI"
            value={aiUse}
            onChange={(e) => {
              setAiUse(e.target.value as AiUse | '');
            }}
          >
            <option value="">No AI recorded</option>
            {AI_USE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {AI_USE_LABELS[option] ?? option}
              </option>
            ))}
          </select>
          <Text as="p" tone="faint" size="xs">
            {AI_USE_HELP}
          </Text>
          <Text as="p" tone="faint" size="xs">
            Written as manual · {userId ? 'you' : 'signed-in user'} · confidence 1.00. Lifecycle and External default —
            {writeBranch?.kind === 'main' ? ' defaulted on create · active in the live model.' : ' defaulted on create · planned on a change.'}
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

      {search.showCreate && sheetOpen && showPlatformPicker && (!contributorAtMain || proposedBranch) && (
        <div className={styles.sheet} data-testid="add-container-sheet">
          {writeBranch?.kind === 'change' && (
            <>
              <Text as="p" tone="muted" size="sm">
                Adding to change: {writeBranch.title ?? writeBranch.name}
              </Text>
              <Text as="p" tone="faint" size="xs">
                Won&apos;t be found by search until this change merges.
              </Text>
            </>
          )}
          <Text as="label" size="sm">
            Which platform is this a module of? (required)
          </Text>
          {platform ? (
            <Text as="p" size="sm">
              Module of <strong>{platform.name}</strong>.{' '}
              <Button
                variant="ghost"
                onClick={() => {
                  setPlatform(null);
                }}
                disabled={createStatus === 'creating'}
              >
                Change
              </Button>
            </Text>
          ) : (
            <div>
              <input
                type="text"
                className={styles.input}
                placeholder="Search for the platform this is a module of…"
                value={platformSearch.query}
                onChange={(e) => {
                  platformSearch.setQuery(e.target.value);
                }}
              />
              {platformSearch.status === 'loading' && (
                <Text as="p" tone="muted" size="sm">
                  Loading…
                </Text>
              )}
              {platformSearch.results.length > 0 && (
                <ul className={styles.results}>
                  {platformSearch.results.map((result) => (
                    <li key={result.element_id}>
                      <button
                        type="button"
                        className={styles.resultRow}
                        onClick={() => {
                          setPlatform({ id: result.element_id, name: result.name });
                        }}
                      >
                        <ElementTypeGlyph type={result.element_type} />
                        <Text as="span">{result.name}</Text>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Text as="p" tone="faint" size="xs">
            Written as manual · {userId ? 'you' : 'signed-in user'} · confidence 1.00.
          </Text>
          <div className={styles.actions}>
            <Button variant="primary" disabled={createStatus === 'creating' || platform === null} onClick={() => void create(search.query)}>
              {createStatus === 'creating' ? 'Creating…' : 'Create'}
            </Button>
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
  dismissed_identity_pairs: [],
  intent: null,
  project_id: null,
};
