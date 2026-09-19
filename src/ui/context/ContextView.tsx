import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { Chip } from '../components/Chip/Chip';
import { LinkButton } from '../components/Button/LinkButton';
import { DiffBadge } from '../components/DiffBadge/DiffBadge';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { ContextDiagramCanvas } from './ContextDiagramCanvas';
import { ContextMobileList } from './ContextMobileList';
import type { ContextGroup } from './contextGrouping';
import styles from './ContextView.module.css';

export interface ContextViewProps {
  group: ContextGroup;
  orgSlug: string;
  modelSlug: string;
  /** The full `ref=...` query fragment (`refQueryParam`), not a bare token — see `CapabilityMapView.tsx`'s identical `refParam` doc comment for why. */
  refParam: string;
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active. Kept for the hub's own header badge only — V1's new canvas/mobile-list body has no diff treatment of its own (see this component's own module comment for why). */
  diff?: VersionDiff | null;
  /** V2b's click-to-focus, forwarded to `ContextDiagramCanvas` only — the mobile list has no Inspector of its own (`ContextPage.tsx`'s own comment: its rows already show everything Selection/Connections would). */
  focusedElementId: UUID | null;
  onFocusElement: (elementId: UUID) => void;
  onClearFocus: () => void;
}

const MOBILE_BREAKPOINT_PX = 768;

/**
 * The Context view's renderer (UI-principles §6.1: "one system, every
 * system/actor it has a relationship with... radial, scope at centre,
 * externals outside a ring"). V1 (docs/prompts/atlas-prompt-pack.md)
 * replaces this view's own body with a real diagram — `ContextDiagramCanvas.tsx`
 * on desktop, `ContextMobileList.tsx` below `MOBILE_BREAKPOINT_PX` — on the
 * landscape's own canvas technology, finally delivering on UI-principles
 * §6.1's closing paragraph ("the same renderer, a different query and
 * layout preset") that the DOM/CSS departure this view took before V1 was
 * itself recorded as a deviation from (§10 decision 7).
 *
 * V3 ("container context pages, platform context simplified to structure
 * only"): this component now only ever renders the "hub + its own direct
 * neighbours" case — a plain system, a container (item 1: a real hub in its
 * own right now), or a platform with zero modules. A platform with at least
 * one module never reaches here at all; `useElementContext.ts` routes it to
 * `PlatformStructureView.tsx` instead, so the module-grouped "Supports:"
 * line and the diagram's own module-tile handling this component used to
 * carry are gone — every neighbour/flow rendering below now only ever
 * handles one hub's own relationships, never a nested module's.
 *
 * V2 (Context layout v2, item 5): the header's own "Supports: ..."/
 * "Owned by: ..." lines are gone — that's Inspector content now
 * (`ContextInspectorContent.tsx`'s own hub-as-default-selection case), not
 * a permanent line competing with the canvas for space. The hub title row
 * below (name, glyph, external chip, diff badge, "Containers →") stays;
 * only the summary lines moved.
 *
 * No diff highlighting on the canvas/mobile body — V1 doesn't ask for it,
 * unlike the landscape, and this view's own diff support stays scoped to
 * the hub's header badge, unchanged from before this sprint.
 */
export function ContextView({ group, orgSlug, modelSlug, refParam, diff = null, focusedElementId, onFocusElement, onClearFocus }: ContextViewProps) {
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?${refParam}`;
  const neighbourContextHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/context/${elementId}?${refParam}`;
  const containersHref = `/o/${orgSlug}/m/${modelSlug}/container/${group.hub.element_id}?${refParam}`;
  const hubExternal = attributesRecord(group.hub.attributes).isExternal === true;
  const diffById = new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []);
  const hubDiff = diffById.get(group.hub.element_id);

  return (
    <div>
      <div className={styles.hub}>
        <div className={styles.hubTitle}>
          <ElementTypeGlyph type={group.hub.element_type} external={hubExternal} />
          <Link to={elementHref(group.hub.element_id)}>
            <Text as="span" size="lg">
              {group.hubDisplayName}
            </Text>
          </Link>
          {hubExternal && <Chip tone="neutral">external</Chip>}
          {diff && hubDiff && <DiffBadge state={hubDiff.state} changedCount={hubDiff.state === 'changed' ? hubDiff.changedAttributes.length : undefined} />}
        </div>
        {/* The one "descend a level" affordance this view offers (UI-principles §2.1's semantic zoom, as a discrete link rather than a continuous gesture this sprint doesn't build — see CapabilityMapView's own "→ Landscape" link for the same pattern one level up). A container is structurally terminal since "component" was removed (S1 item 18) — it has no containers of its own to descend into. */}
        {group.hub.element_type === 'system' && (
          <LinkButton to={containersHref} variant="secondary">
            Containers →
          </LinkButton>
        )}
      </div>

      {group.internal.length === 0 && group.external.length === 0 && group.owners.length === 0 && (
        <div>
          <EmptyState>No connections to other systems or actors yet.</EmptyState>
          <LinkButton to={elementHref(group.hub.element_id)} variant="secondary">
            Add a relationship on the element page →
          </LinkButton>
        </div>
      )}

      {(group.internal.length > 0 || group.external.length > 0) && (
        <div className={styles.diagram}>
          {narrow ? (
            <ContextMobileList group={group} elementHref={elementHref} neighbourContextHref={neighbourContextHref} />
          ) : (
            <ContextDiagramCanvas
              group={group}
              elementHref={elementHref}
              neighbourContextHref={neighbourContextHref}
              focusedElementId={focusedElementId}
              onFocusElement={onFocusElement}
              onClearFocus={onClearFocus}
            />
          )}
        </div>
      )}
    </div>
  );
}
