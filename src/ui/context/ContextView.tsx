import type { ReactElement } from 'react';
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

// Prompt 7k item 2: "Business owner: Housing · Technical owner: IT
// Operations" — a fixed, deterministic role order (not alphabetical: reads
// business-first, the same priority `elementBrowse.ts`'s own owner-column
// preference gives it), each rendered only when at least one owner holds
// it. A role this product doesn't know about (shouldn't happen — `OwnsRole`
// is a closed union — but this reads plain strings off stored data) falls
// back to the raw value, capitalised, rather than being silently dropped.
const OWNS_ROLE_ORDER = ['business', 'technical', 'service'] as const;
function ownsRoleLabel(role: string): string {
  const known: Record<string, string> = { business: 'Business', technical: 'Technical', service: 'Service' };
  return known[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

export interface ContextViewProps {
  group: ContextGroup;
  orgSlug: string;
  modelSlug: string;
  /** The full `ref=...` query fragment (`refQueryParam`), not a bare token — see `CapabilityMapView.tsx`'s identical `refParam` doc comment for why. */
  refParam: string;
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active. Kept for the hub's own header badge only — V1's new canvas/mobile-list body has no diff treatment of its own (see this component's own module comment for why). */
  diff?: VersionDiff | null;
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
 * The hub block's own "Supports: ..."/"Owned by: ..." header lines
 * (`.headerSummary` below) are kept exactly as V1's own wording asks
 * ("Header keeps Supports ... and Owned by") — real header content, never
 * a diagram node or a drawn edge, same as before this sprint.
 *
 * No diff highlighting on the canvas/mobile body — V1 doesn't ask for it,
 * unlike the landscape, and this view's own diff support stays scoped to
 * the hub's header badge, unchanged from before this sprint.
 */
export function ContextView({ group, orgSlug, modelSlug, refParam, diff = null }: ContextViewProps) {
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);
  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}?${refParam}`;
  const neighbourContextHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/context/${elementId}?${refParam}`;
  const containersHref = `/o/${orgSlug}/m/${modelSlug}/container/${group.hub.element_id}?${refParam}`;
  const hubExternal = attributesRecord(group.hub.attributes).isExternal === true;
  const diffById = new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []);
  const hubDiff = diffById.get(group.hub.element_id);
  // S1 item 11a — see the "Owned by" line's own comment below.
  const internalOwners = group.owners.filter((o) => !o.isExternal);
  const externalOwners = group.owners.filter((o) => o.isExternal);
  // V1 polish, "header collapses to a one-line summary when the diagram
  // renders": the same condition that decides whether the diagram body
  // mounts below (`(group.internal.length > 0 || group.external.length >
  // 0)`) — once the diagram is taking up real canvas space, the header
  // doesn't also need three separate paragraphs' worth of the same facts;
  // one compact line, still linking every name, does. The empty-state case
  // (no diagram at all) keeps the fuller, multi-line summary unchanged —
  // there's no canvas competing for space there.
  const hasDiagram = group.internal.length > 0 || group.external.length > 0;

  const supportsDirectPart =
    group.supports.length > 0 ? (
      <>
        Supports:{' '}
        {group.supports.map((s, i) => (
          <span key={s.capability.element_id}>
            {i > 0 && ', '}
            <Link to={elementHref(s.capability.element_id)}>{s.capability.name}</Link>
          </span>
        ))}
      </>
    ) : null;

  const ownersPart =
    group.owners.length > 0 ? (
      <>
        {OWNS_ROLE_ORDER.filter((role) => internalOwners.some((o) => o.role === role)).map((role, groupIndex) => (
          <span key={role}>
            {groupIndex > 0 && ' · '}
            {ownsRoleLabel(role)} owner:{' '}
            {internalOwners
              .filter((o) => o.role === role)
              .map((owner, i) => (
                <span key={owner.actor.element_id}>
                  {i > 0 && ', '}
                  <Link to={elementHref(owner.actor.element_id)}>{owner.actor.name}</Link>
                </span>
              ))}
          </span>
        ))}
        {externalOwners.length > 0 && (
          <span>
            {internalOwners.length > 0 && ' · '}
            External:{' '}
            {externalOwners.map((owner, i) => (
              <span key={owner.actor.element_id}>
                {i > 0 && ', '}
                <Link to={elementHref(owner.actor.element_id)}>{owner.externalOrganisation ?? owner.actor.name}</Link>
              </span>
            ))}
          </span>
        )}
      </>
    ) : null;

  const collapsedSummaryParts = [supportsDirectPart, ownersPart].filter((p): p is ReactElement => p !== null);

  return (
    <div>
      <div className={styles.hub}>
        <div className={styles.hubTitle}>
          <ElementTypeGlyph type={group.hub.element_type} external={hubExternal} />
          <Link to={elementHref(group.hub.element_id)}>
            <Text as="span" size="lg">
              {group.hub.name}
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

      {(group.supports.length > 0 || group.owners.length > 0) &&
        (hasDiagram ? (
          // V1 polish: one compact line once the diagram is rendering
          // below — same content as the fuller block, just not competing
          // with the canvas for vertical space.
          <Text as="p" tone="muted" size="sm" className={styles.headerSummaryCollapsed}>
            {collapsedSummaryParts.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
          </Text>
        ) : (
          <div className={styles.headerSummary}>
            {/* Item 12: "Supports: <capabilities, primary first>", each one a
                link — computeContextGroup already sorted the list; this just
                renders it, and the capability's own element page is the link
                target (the same page every other Context/element-page link in
                this view already points at). */}
            {supportsDirectPart && (
              <Text as="p" tone="muted" size="sm">
                {supportsDirectPart}
              </Text>
            )}
            {ownersPart && (
              <Text as="p" tone="muted" size="sm">
                {/* Prompt 7k item 2: grouped by role ("Business owner: Housing
                    · Technical owner: IT Operations"), not a single flat
                    "Owned by:" list — computeContextGroup already sorted
                    `owners` by role, so within each role group the actors are
                    already in the right order too. S1 item 11a: only ever
                    *internal* owners here — an external owner can only ever
                    hold role "service" (C20, src/engine/deltas.ts), and is
                    split into its own trailing "External:" clause below
                    instead, naming the organisation rather than folding it
                    in as one more "Service owner" name indistinguishable
                    from an internal one. */}
                {ownersPart}
              </Text>
            )}
          </div>
        ))}

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
            <ContextDiagramCanvas group={group} elementHref={elementHref} neighbourContextHref={neighbourContextHref} />
          )}
        </div>
      )}
    </div>
  );
}
