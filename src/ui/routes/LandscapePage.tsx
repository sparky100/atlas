import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AppHeader } from '../components/AppHeader/AppHeader';
import { Breadcrumb, type BreadcrumbSegment } from '../components/Breadcrumb/Breadcrumb';
import { CommentsPanel } from '../components/CommentsPanel/CommentsPanel';
import { DiffLegend } from '../components/DiffBadge/DiffLegend';
import { ElementSearchAdd } from '../components/ElementSearchAdd/ElementSearchAdd';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { ModelNav } from '../components/ModelNav/ModelNav';
import navStyles from '../components/ModelNav/ModelNav.module.css';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useThreadCounts } from '../comments/useThreadCounts';
import { useModels } from '../models/useModels';
import { canEditBranch, useMembership } from '../orgs/useMembership';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { refLabelOf, refParamOf } from '../../db/ref';
import { parseViewMode } from '../../db/viewMode';
import { BranchViewModeControl } from '../branches/BranchViewModeControl';
import { EditingBranchBanner } from '../branches/EditingBranchBanner/EditingBranchBanner';
import { useBranchLabel } from '../branches/useBranchLabel';
import { useEditingBranch } from '../branches/useEditingBranch';
import { useMainBranch } from '../branches/useMainBranch';
import { useSelectedRef } from '../branches/useSelectedRef';
import { LandscapeCanvas } from '../landscape/LandscapeCanvas';
import { LANDSCAPE_COLOUR_BY_OPTIONS } from '../landscape/landscapeColour';
import { LandscapeMobileList } from '../landscape/LandscapeMobileList';
import { useCanvasWidth } from '../landscape/useCanvasWidth';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { useLandscape } from '../landscape/useLandscape';
import { useLandscapeColourByPreference } from '../landscape/useLandscapeColourByPreference';
import { useBreadcrumbElement } from '../nav/useBreadcrumbElement';
import { parseCapabilityParam, zoomQueryString } from '../nav/zoomParams';
import styles from './LandscapePage.module.css';

/**
 * The Landscape view (UI-principles.md §6.1, Sprint U1 step 4a): systems in
 * swim-lanes by the capability they support, `uses`/`flows_to` edges
 * between them. Sprint U2 step 3 adds the "optional capability filter"
 * §6.1's own Landscape row names (`?capability=`, src/ui/nav/zoomParams.ts)
 * — the zoom chain's second stop, reached from a capability tile's own
 * "→ Landscape" link — and Context/Container/Component, which reuse the
 * same renderer with their own query and layout preset (this step, not a
 * later one anymore). No Web Worker for those three (see their own view
 * comments); the landscape itself keeps its Sprint U1 4b worker/viewport-
 * culling/LOD work — the only view kind with §8.6's performance budget.
 *
 * Blocking: element creation adds the search-first "Add" control here for
 * systems and actors (src/ui/components/ElementSearchAdd/ElementSearchAdd.tsx)
 * — the empty-state affordance the landscape never had before ("Add a
 * System from the element page" pointed at a page you could only reach by
 * already knowing a system's id, i.e. nowhere).
 *
 * Sprint U4-1 E1: at >= 768px (the app's own mobile breakpoint —
 * ModelNav.tsx/UserMenu.tsx/UI-principles.md §2 — 390px, the sprint's own
 * narrow-mobile floor from C2, is a Playwright viewport width to prove no
 * horizontal overflow at, not a second breakpoint) the header actions row
 * is "+ Add system", "+ Add actor" inline. Below it, those two collapse
 * into one "+ Add" disclosure — `useIsNarrowViewport` decides which
 * arrangement actually *mounts* (not a CSS-only show/hide of both) so
 * `ElementSearchAdd`'s own search-pool fetch never runs twice for one page
 * load.
 *
 * Sprint U4-2b item 6: "Reset layout" (and the "⋯" overflow menu it used
 * to be the narrow viewport's only occupant of) is gone entirely — the
 * landscape auto-lays-out on every open now, with no `view_layouts` row to
 * reset (`useLandscape.ts`'s own comment, UI-principles §6.4).
 *
 * Sprint U4-2b item 7: `useCanvasWidth` measures `<main>` and feeds that
 * width through `useLandscape` as the layout's width hint — see that
 * hook's own comment.
 *
 * Sprint U4-2b item 13: the same 768px breakpoint also decides which
 * *content* renderer mounts below the header — `LandscapeMobileList` (a
 * collapsible list, `landscapeGroups.ts`'s own module comment has the full
 * grouping rules) instead of `LandscapeCanvas`, never both. The desktop
 * canvas itself, and everything about it (the `.mainWithCanvas` full-width
 * treatment — keyed on viewport width alone, see `canvasWidthClass` below
 * — `useThreadCounts`, the comments panel), stays exactly as it was — the
 * list is a second renderer for the same `state.data`, not a replacement,
 * and doesn't need any of that (no pixels, no viewport culling, no
 * worker), so it renders inside the page's ordinary centred column
 * instead.
 */
export function LandscapePage() {
  const { orgSlug, modelSlug } = useParams<{ orgSlug: string; modelSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ref } = useSelectedRef();
  const mode = parseViewMode(searchParams.get('mode'));
  const capabilityId = parseCapabilityParam(searchParams.get('capability'));
  const { userId } = useAuth();

  const { organisation, loading: orgLoading } = useOrganisationBySlug(orgSlug ?? '');
  const { models, loading: modelsLoading } = useModels(organisation?.id ?? null);
  const model = models.find((m) => m.slug === modelSlug);
  const capability = useBreadcrumbElement(model?.id ?? null, ref, capabilityId);
  const { label: branchLabel } = useBranchLabel(ref);
  const { role } = useMembership(organisation?.id ?? null, userId);
  const { branch: editingBranch } = useEditingBranch(model?.id ?? null, ref);
  // Search always scans main's real head, regardless of which ref/branch is
  // being viewed (src/db/elementSearch.ts's own module comment) — only the
  // write target (`editingBranch`) varies with the ref.
  const { branch: mainBranch, reload: reloadMainBranch } = useMainBranch(model?.id ?? null);
  const canEdit = editingBranch !== null && canEditBranch(role, editingBranch);
  // ADR-018 guarantees both are never null in practice (every branch always
  // has a real head, from genesis onward) — `BranchRow`'s own type hasn't
  // been narrowed to match yet (a separate, wider cleanup touching every
  // `!branch.head_commit_id` guard in src/db), so this control checks it
  // explicitly rather than asserting it away.
  const searchCommitId = mainBranch?.head_commit_id ?? null;
  const writeHeadCommitId = editingBranch?.head_commit_id ?? null;
  const canAdd = canEdit && searchCommitId !== null && writeHeadCommitId !== null;

  // Item 7: `<main>`'s own measured width, fed to `useLandscape` as the
  // layout's width hint — see `useCanvasWidth.ts`'s own comment for why
  // `<main>` (rendered in every state) is what gets measured, not the
  // canvas element itself.
  const { ref: canvasWidthRef, width: canvasWidth } = useCanvasWidth();

  // Sprint U4-2a item 2: `searchCommitId` above is already `mainBranch`'s
  // head, from the one `useMainBranch` call this route makes — handing it
  // to `useLandscape` as its main-commit hint means `ref.kind === 'main'`
  // (no `?ref=` at all, the common case) never re-fetches the identical
  // `main` row a second time. See useLandscape.ts's own doc comment.
  const { state } = useLandscape(model?.id ?? null, organisation?.id ?? null, userId, ref, mode, capabilityId, searchCommitId, canvasWidth ?? undefined);

  // Sprint U4-1 E1: see this component's own module comment.
  const narrow = useIsNarrowViewport(768);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuId = useId();

  // Sprint M1b (`docs/HANDOFF-M1b-comments.md`'s Canvas section, direction
  // 5a): the panel is scoped to one system at a time, opened by clicking a
  // node's own comment marker or by `c`/`n` on the hovered node
  // (`LandscapeCanvas`'s own prop comments) — the canvas has no other
  // "selected node" concept yet, so hover stands in for it.
  const [commentsPanelElementId, setCommentsPanelElementId] = useState<UUID | null>(null);
  const [autoFocusComposer, setAutoFocusComposer] = useState(false);
  const anchorIds = state.status === 'ready' ? [...state.data.systemsById.keys()] : [];
  const threadCountsState = useThreadCounts(model?.id ?? null, anchorIds);
  const threadCounts = threadCountsState.status === 'ready' ? threadCountsState.counts : undefined;
  // M1 close-out item 1's own "per-session 'comments on this view' filter"
  // — plain component state, not `user_preferences` or anything else
  // persisted server-side: it resets on every fresh visit to this page
  // (a new tab, a reload), the same "per session" scope `reorderMode`
  // (CapabilityMapPage.tsx) already gives a view-only toggle that isn't
  // worth carrying across visits.
  const [commentsOnlyFilter, setCommentsOnlyFilter] = useState(false);
  // Prompt 7k item 1: the landscape's own colour-by mode — desktop canvas
  // only, same "no comment wiring on mobile's list yet" scoping as the
  // comments-only filter above.
  const { colourBy, setColourBy } = useLandscapeColourByPreference(userId);
  const colourById = useId();
  // Prompt 7k item 4: "route via platforms" — direct edges by default,
  // same unpersisted-per-session shape as `commentsOnlyFilter` above
  // (the plan's own note: "unpersisted local/URL state, not a new
  // preference column, to keep this item's migration footprint at zero").
  const [routeViaPlatforms, setRouteViaPlatforms] = useState(false);

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

  const refParam = refParamOf(ref);
  const segments: BreadcrumbSegment[] = capability ? [{ label: capability.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}/capability-map?ref=${refParam}` }] : [];
  const nodeHref = (systemId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/context/${systemId}?${zoomQueryString({ ref, capabilityId })}`;
  // Landscape canvas, structural (item 3): an actor has no Context view of
  // its own (the zoom chain is system-specific), so this goes straight to
  // the actor's own element page instead — the same target item 13's
  // mobile list uses for both its system and actor rows' own tap target
  // ("tap → element page", `LandscapeMobileList.tsx`'s own prop comment).
  const elementHref = (elementId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${elementId}?ref=${refParam}`;
  // Item 11: a lane key that isn't `$external`/`$unassigned` is a level-1
  // capability's own element id (`layout.ts`'s `placementFor`) — its
  // element page, same shape as `elementHref` above, works regardless of
  // where in the capability tree it sits (unlike a capability-map anchor,
  // which would need to know the map's own scroll position).
  const capabilityHref = (capabilityId: string) => `/o/${orgSlug ?? ''}/m/${model.slug}/e/${capabilityId}?ref=${refParam}`;

  // Shared between the >=768px inline row and the <768px "+ Add" menu
  // (E1) — same two controls, a different wrapper around them.
  const addControls = canAdd && (
    <>
      <ElementSearchAdd
        elementType="system"
        buttonLabel="+ Add system"
        parentId={null}
        modelId={model.id}
        orgId={organisation?.id ?? ''}
        userId={userId}
        searchCommitId={searchCommitId}
        branch={editingBranch}
        expectedHeadCommitId={writeHeadCommitId}
        orgSlug={organisation?.slug ?? ''}
        modelSlug={model.slug}
        refParam={refParam}
        onCreated={reloadMainBranch}
      />
      <ElementSearchAdd
        elementType="actor"
        buttonLabel="+ Add actor"
        parentId={null}
        modelId={model.id}
        orgId={organisation?.id ?? ''}
        userId={userId}
        searchCommitId={searchCommitId}
        branch={editingBranch}
        expectedHeadCommitId={writeHeadCommitId}
        orgSlug={organisation?.slug ?? ''}
        modelSlug={model.slug}
        refParam={refParam}
        onCreated={reloadMainBranch}
      />
    </>
  );

  // Sprint U4-2a item 5: "canvas routes fill the viewport" — only where the
  // canvas *can* render at this viewport width. Item 13: never on mobile —
  // the list renders inside the ordinary column, full-width treatment is a
  // canvas-specific need this content doesn't have.
  const hasContent = state.status === 'ready' && (state.data.layout.nodes.length > 0 || state.data.layout.actorNodes.length > 0);
  const showCanvas = hasContent && !narrow;
  // Item 7 regression fix: the CSS-class decision below must NOT depend on
  // `hasContent` (load state), unlike `showCanvas` above (correct for
  // deciding *what renders*). `<main>` is the element `canvasWidthRef`
  // measures, and that measurement feeds `useLandscape`'s `layoutWidthHint`
  // — itself one of that hook's own effect dependencies. Coupling the class
  // to `hasContent` meant every loading→ready transition flipped the class,
  // resized `<main>`, re-fired the `ResizeObserver`, and re-triggered the
  // very reload that flips `hasContent` again: an infinite loop (confirmed
  // live — the page never finished loading). Keying the class on `!narrow`
  // alone keeps `<main>`'s width stable across loading/ready/error/empty,
  // since the canvas is never shown on mobile regardless of content.
  const canvasWidthClass = !narrow;

  return (
    <div>
      <AppHeader />
      <div className={navStyles.body}>
        <ModelNav orgSlug={orgSlug ?? ''} modelSlug={modelSlug ?? ''} />
        <main ref={canvasWidthRef} className={[styles.main, canvasWidthClass ? styles.mainWithCanvas : ''].filter(Boolean).join(' ')}>
        <EditingBranchBanner activeRef={ref} />
        <Breadcrumb
          org={{ label: organisation?.name ?? '', href: `/o/${orgSlug ?? ''}` }}
          model={{ label: model.name, href: `/o/${orgSlug ?? ''}/m/${model.slug}` }}
          refLabel={refLabelOf(ref, branchLabel)}
          segments={segments}
        />
        <div className={styles.header}>
          <Text as="h1" size="2xl" className={styles.title}>
            Landscape{capability ? `: systems supporting ${capability.name}` : ''}
          </Text>
          {/* Prompt 7k item 1: the landscape's own colour-by mode — desktop canvas only, same scoping as the comments-only filter beside it. */}
          {state.status === 'ready' && showCanvas && (
            <div className={styles.actions}>
              <div className={styles.colourByControl}>
                <label htmlFor={colourById}>
                  <Text as="span" size="sm" tone="muted">
                    Colour by
                  </Text>
                </label>
                <select
                  id={colourById}
                  className={styles.select}
                  value={colourBy}
                  onChange={(e) => {
                    setColourBy(e.target.value as typeof colourBy);
                  }}
                >
                  <option value="none">None</option>
                  {LANDSCAPE_COLOUR_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {/* M1 close-out item 1: "the per-session 'comments on this view' filter" — desktop canvas only (mobile's own list carries no comment wiring yet, item 13's own comment above); toggled independently of `+ Add`, so it's its own `.actions` group rather than folded into `addControls`. */}
          {state.status === 'ready' && showCanvas && (
            <div className={styles.actions}>
              <label className={styles.commentsOnlyToggle}>
                <input
                  type="checkbox"
                  checked={commentsOnlyFilter}
                  onChange={(e) => {
                    setCommentsOnlyFilter(e.target.checked);
                  }}
                />
                <Text as="span" size="sm" tone="muted">
                  Comments on this view
                </Text>
              </label>
            </div>
          )}
          {/* Prompt 7k item 4: "route via platforms" — off (direct edges) by default, desktop canvas only, same unpersisted per-session toggle shape as the comments-only filter above. */}
          {state.status === 'ready' && showCanvas && (
            <div className={styles.actions}>
              <label className={styles.commentsOnlyToggle}>
                <input
                  type="checkbox"
                  checked={routeViaPlatforms}
                  onChange={(e) => {
                    setRouteViaPlatforms(e.target.checked);
                  }}
                />
                <Text as="span" size="sm" tone="muted">
                  Route via platforms
                </Text>
              </label>
            </div>
          )}
          {state.status === 'ready' && !narrow && addControls && <div className={styles.actions}>{addControls}</div>}
          {state.status === 'ready' && narrow && canAdd && (
            <div className={styles.actions}>
              <div className={styles.menuWrapper}>
                <button
                  type="button"
                  className={styles.menuToggle}
                  aria-expanded={addMenuOpen}
                  aria-controls={addMenuId}
                  onClick={() => {
                    setAddMenuOpen((o) => !o);
                  }}
                >
                  <Text as="span">+ Add</Text>
                </button>
                <div id={addMenuId} className={[styles.menu, addMenuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
                  {addControls}
                </div>
              </div>
            </div>
          )}
        </div>

        {ref.kind === 'branch' && (
          <BranchViewModeControl
            mode={mode}
            onChange={(next) => {
              setSearchParams((prev) => {
                const updated = new URLSearchParams(prev);
                updated.set('mode', next);
                return updated;
              });
            }}
          />
        )}
        {ref.kind === 'branch' && mode === 'diff' && <DiffLegend />}

        {state.status === 'loading' && <Text tone="muted">Loading…</Text>}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'refNotFound' && <Text as="p">This model has no commits yet at this ref.</Text>}
        {state.status === 'ready' && state.data.layout.nodes.length === 0 && state.data.layout.actorNodes.length === 0 && (
          <div>
            <EmptyState>{capability ? 'No systems support this capability yet.' : 'No systems yet.'}</EmptyState>
            {!capability && canAdd && (
              <div className={styles.actions}>
                <ElementSearchAdd
                  elementType="system"
                  buttonLabel="Add a system"
                  parentId={null}
                  modelId={model.id}
                  orgId={organisation?.id ?? ''}
                  userId={userId}
                  searchCommitId={searchCommitId}
                  branch={editingBranch}
                  expectedHeadCommitId={writeHeadCommitId}
                  orgSlug={organisation?.slug ?? ''}
                  modelSlug={model.slug}
                  refParam={refParam}
                  onCreated={reloadMainBranch}
                />
              </div>
            )}
          </div>
        )}
        {/* Item 13: <768px renders the list, never the canvas — same `state.data`, no comments panel/unresolved-count wiring (this list carries none of that yet), no viewport-fit math. */}
        {state.status === 'ready' && hasContent && narrow && <LandscapeMobileList groups={state.data.groups} elementHref={elementHref} contextHref={nodeHref} />}
        {state.status === 'ready' && showCanvas && (
          <div className={styles.canvasRow}>
            <LandscapeCanvas
              layout={state.data.layout}
              systemsById={state.data.systemsById}
              actorsById={state.data.actorsById}
              edges={state.data.edges}
              diff={state.data.diff}
              nodeHref={nodeHref}
              actorHref={elementHref}
              capabilityHref={capabilityHref}
              threadCounts={threadCounts}
              commentsOnlyFilter={commentsOnlyFilter}
              colourBy={colourBy}
              routeViaPlatforms={routeViaPlatforms}
              onCommentMarkerClick={(elementId) => {
                setCommentsPanelElementId(elementId);
                setAutoFocusComposer(false);
              }}
              onToggleCommentsPanel={(elementId) => {
                if (commentsPanelElementId !== null) {
                  setCommentsPanelElementId(null);
                } else if (elementId) {
                  setCommentsPanelElementId(elementId);
                  setAutoFocusComposer(false);
                }
              }}
              onNewCommentShortcut={(elementId) => {
                setCommentsPanelElementId(elementId);
                setAutoFocusComposer(true);
              }}
            />
            {commentsPanelElementId && (
              <CommentsPanel
                orgId={organisation?.id ?? ''}
                modelId={model.id}
                userId={userId}
                role={role}
                anchorType="element"
                anchorId={commentsPanelElementId}
                subjectName={state.data.systemsById.get(commentsPanelElementId)?.name ?? ''}
                unresolvedCount={threadCounts?.get(commentsPanelElementId)?.open ?? 0}
                branchId={ref.kind === 'branch' ? (editingBranch?.id ?? null) : null}
                viewKind="landscape"
                autoFocusComposer={autoFocusComposer}
                onClose={() => {
                  setCommentsPanelElementId(null);
                }}
              />
            )}
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
