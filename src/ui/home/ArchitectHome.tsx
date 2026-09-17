import { Fragment } from 'react';
import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { FindingCard, type FindingCardAction } from '../components/HealthFinding/FindingCard';
import { joinWithMore, type HealthFindingItem } from '../components/HealthFinding/healthFindingFormat';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { MemberRole } from '../../db/types';
import type { BoundaryCrossing, ExternalInterfaceCrossing, ExternalOrganisationAccess, PlatformFlowEndpoint, UnlabeledVerbRelationship } from '../../db/healthFindings';
import { formatRelativeTime } from '../time';
import { branchStatusTone } from '../changes/branchStatus';
import {
  decisionPrefillToSearchParams,
  prefillFromCapabilityNoSupportersFinding,
  prefillFromCriticalExposedFinding,
  prefillFromCriticalSupportEndFinding,
  prefillFromPoorFitCapabilityFinding,
  type DecisionPrefill,
} from '../decisions/decisionPrefill';
import { canStartDecision } from '../orgs/useMembership';
import { selectRecentActivity, type GroupedActivityItem } from './groupRecentActivity';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';
import type { ArchitectHomeData, RecentCommitRow } from './useArchitectHome';
import styles from './DoorHome.module.css';

export interface ArchitectHomeProps {
  data: ArchitectHomeData;
  /** Gates every "Start a decision →" card action below (`canStartDecision`) — omitted entirely, not shown disabled, for a viewer. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** `ElementsHeadRow[]` → `HealthFindingItem[]` — every element-shaped finding's items are just names (the browse-table/decision link is the actionable part, per-item actions having moved to the browse table's own rows). */
function elementItems(elements: readonly ElementsHeadRow[]): HealthFindingItem[] {
  return elements.map((el) => ({ id: el.element_id, label: el.name }));
}

/** Sprint U4-1 B5's own finding is relationship pairs, not elements — its own `HealthFindingItem[]` builder. */
function unlabeledRelationshipItems(edges: readonly UnlabeledVerbRelationship[]): HealthFindingItem[] {
  return edges.map((edge) => ({ id: edge.relationshipId, label: `${edge.fromName} → ${edge.toName}` }));
}

/** Prompt 7k item 3: boundary crossings are relationship pairs too, same shape as `unlabeledRelationshipItems` above. */
function boundaryCrossingItems(crossings: readonly BoundaryCrossing[]): HealthFindingItem[] {
  return crossings.map((crossing) => ({ id: crossing.relationshipId, label: `${crossing.fromName} → ${crossing.toName}` }));
}

/** S1 item 11a: the enterprise/external boundary's own crossings — same shape again, a different boundary. */
function externalInterfaceItems(crossings: readonly ExternalInterfaceCrossing[]): HealthFindingItem[] {
  return crossings.map((crossing) => ({ id: crossing.relationshipId, label: `${crossing.fromName} → ${crossing.toName}` }));
}

/** S1 item 11a's own second Assurance row — one row per external actor's own `uses` edge, naming the organisation and what it reaches. */
function externalOrganisationAccessItems(access: readonly ExternalOrganisationAccess[]): HealthFindingItem[] {
  return access.map((a) => ({ id: a.relationshipId, label: `${a.organisation} uses ${a.systemName}` }));
}

/** S1 item 20's own nudge — relationship pairs again, same shape as `boundaryCrossingItems`. */
function platformFlowEndpointItems(endpoints: readonly PlatformFlowEndpoint[]): HealthFindingItem[] {
  return endpoints.map((endpoint) => ({ id: endpoint.relationshipId, label: `${endpoint.fromName} → ${endpoint.toName}` }));
}

/** Item 4's own "titles truncated at ~60 chars" — an ellipsis, not a hard cut, and only ever applied to the display string (diff links/subjects below are built from the untruncated title). */
function truncateTitle(title: string, max = 60): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

/**
 * Architect-door layout prompt: a check's one inline action — its own
 * `singleItemAction` when there's exactly one item to act on directly
 * (a decision-shaped finding's "Start a decision", or
 * `unused-integration-platform`'s "View context →" — see that field's own
 * doc comment, `healthChecks.ts`), otherwise `browseHref` (housekeeping
 * findings, and a *multi*-item single-item-actionable finding's own
 * filtered list — where a decision-shaped finding's rows each carry their
 * own pre-filled "Start a decision", `ElementBrowseTable.tsx`'s
 * `decisionRowAction`). `null` when a check has neither (a
 * relationship-shaped finding with no browse-table home, e.g.
 * `flows-to-platform-instead-of-module`).
 */
function resolveCardAction(check: HealthCheck): FindingCardAction | null {
  const firstItem = check.items[0];
  if (check.singleItemAction && check.count === 1 && firstItem) return check.singleItemAction(firstItem);
  if (check.browseHref !== undefined) return { href: check.browseHref, label: check.browseLabel ?? 'Review →' };
  return null;
}

/**
 * The architect's door (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment for Health findings —
 * `docs/HANDOFF-7d-architect-door.md`; still scoped down from §3.2's full
 * three-column dashboard otherwise, see `useArchitectHome.ts`'s own
 * comment for exactly what's deferred).
 *
 * Architect-door layout prompt (per-item-actions follow-up): five changes
 * from the door's previous "collapsed row → expand to a paginated list"
 * shape (Sprint U4-1 B3), all in service of one goal — the whole door
 * visible at 1080p without scrolling for a realistically-sized model.
 *
 * 1. A headline stat row (Review queue / findings needing attention /
 *    assurance items / my open changes), the same big-number/muted-label
 *    style the director door's own `.statsRow` already uses — this
 *    replaces the standalone "Review queue" panel's own oversized count,
 *    which now duplicates into one of these four numbers instead.
 *    "Findings needing attention" counts active *checks* (high+medium),
 *    not raw item counts — the same unit "N checks clear" already uses
 *    elsewhere on this door, and the only one that stays meaningful across
 *    checks whose items are systems, relationships, and capabilities all
 *    at once (a judgment call: summing heterogeneous item counts into one
 *    number would answer a different, less useful question).
 * 2. Every active high/medium check renders as a compact 2-line
 *    `FindingCard` in a responsive grid (`FindingCard.tsx`'s own doc
 *    comment has the full shape) instead of `HealthFinding`'s old
 *    expand/paginate plate — `HealthFinding.tsx` is retired entirely, its
 *    per-item action slot's one real use (a decision-shaped finding's
 *    per-item "Start a decision") having moved to the browse table's own
 *    rows (`resolveCardAction`'s own doc comment, `ElementBrowseTable.tsx`'s
 *    `decisionRowAction`).
 * 3. Active *informational* checks are excluded from the grid — they
 *    render as single-line rows beneath it instead (`infoRows` below),
 *    same as before never competing visually with a real gap. "N checks
 *    clear" (`partitionHealthChecks`/`checksClearLabel`) is unchanged.
 * 4. Recent activity keeps its one-line-per-item shape and inline subject
 *    links, now with `truncateTitle` capping a raw commit title at ~60
 *    characters — a collapsed-run synthetic title ("N edits to X") is
 *    already short and untouched by this in practice.
 * 5. Assurance keeps its own `<h3>` but renders through the identical grid
 *    (`gridAssuranceChecks`/`infoAssuranceChecks` below) rather than a
 *    second, parallel layout.
 */
export function ArchitectHome({ data, role, orgSlug, modelSlug }: ArchitectHomeProps) {
  const now = new Date();
  const elementHref = (elementId: string) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}`;
  // A commit's diff against its own parent (Sprint U4-1 B2) — main's genesis
  // commit has no parent to diff against, so it stays plain text below
  // rather than linking anywhere.
  const commitDiffHref = (commit: RecentCommitRow['commit']) =>
    commit.parent_commit_id ? `/o/${orgSlug}/m/${modelSlug}/diff?ref=commit:${commit.id}&diff=commit:${commit.parent_commit_id}` : null;
  // Sprint U4-1 B3: each element-shaped finding's own pre-filter into the
  // browse table (src/ui/elements/useElementBrowse.ts's `filter` param) —
  // the relationship-shaped finding (unlabeledVerbRelationships) has no
  // browse-table home at all, so it gets no href.
  const browseHref = (filter: string) => `/o/${orgSlug}/m/${modelSlug}/elements?filter=${filter}`;
  // S1 item 11a: both new Assurance rows share the one "View all" page —
  // see `useExternalInterfaces.ts`'s own doc comment for why.
  const externalInterfacesHref = `/o/${orgSlug}/m/${modelSlug}/external-interfaces`;
  // Integration platform context prompt: "health finding 'integration
  // platform with nothing via it' links here" — a single unused platform's
  // own `singleItemAction` below sends someone straight to its (empty)
  // Context diagram rather than the browse table.
  const contextHref = (elementId: string) => `/o/${orgSlug}/m/${modelSlug}/context/${elementId}`;
  const startDecisionAction = (prefill: DecisionPrefill): FindingCardAction => ({
    href: `/o/${orgSlug}/m/${modelSlug}/decisions?${decisionPrefillToSearchParams(prefill).toString()}`,
    label: 'Start a decision →',
  });

  // `duplicatesCount` is typed as the literal `0` (still wired to 0 until
  // Q1, ADR-019) — a placeholder notice, not a real check yet, so it's
  // left out of this list and rendered as its own permanent line below
  // rather than something "N checks clear" could ever roll it into.
  const healthChecks: HealthCheck[] = [
    {
      key: 'unlinked-systems',
      count: data.systemsWithoutCapability.length,
      summary: `${String(data.systemsWithoutCapability.length)} ${plural(data.systemsWithoutCapability.length, 'system', 'systems')} not linked to a capability`,
      items: elementItems(data.systemsWithoutCapability),
      severity: 'medium',
      browseHref: browseHref('unlinked-systems'),
      browseLabel: 'Review and link →',
    },
    {
      // S1 item 19: purely informational (see this finding's own doc
      // comment, healthFindings.ts) — the platform already counts as
      // linked either way (findSystemsWithoutCapability above already
      // credits a module's own supports edge), this only nudges that the
      // edge's likely home is one level down.
      key: 'platform-supports-move-to-module',
      count: data.platformSupportsThatShouldMoveToModule.length,
      summary: `${String(data.platformSupportsThatShouldMoveToModule.length)} platform supports edge${data.platformSupportsThatShouldMoveToModule.length === 1 ? '' : 's'} that could move to a module`,
      items: elementItems(data.platformSupportsThatShouldMoveToModule),
      severity: 'medium',
      browseHref: browseHref('platform-supports-move-to-module'),
      browseLabel: 'Review and move →',
    },
    {
      // S1 item 20: the uses/flows_to sibling of the nudge above — same
      // "informational, not a problem" shape; no browse-table home
      // (relationship-shaped, like unlabeledVerbRelationships below), so no
      // browseHref, same as that finding.
      key: 'flows-to-platform-instead-of-module',
      count: data.flowsToPlatformInsteadOfModule.length,
      summary: `${String(data.flowsToPlatformInsteadOfModule.length)} flow${data.flowsToPlatformInsteadOfModule.length === 1 ? '' : 's'} that could point at a module instead of the platform`,
      items: platformFlowEndpointItems(data.flowsToPlatformInsteadOfModule),
      severity: 'medium',
    },
    {
      key: 'unowned-capabilities',
      count: data.capabilitiesWithoutOwner.length,
      summary: `${String(data.capabilitiesWithoutOwner.length)} ${plural(data.capabilitiesWithoutOwner.length, 'capability', 'capabilities')} with no owner`,
      items: elementItems(data.capabilitiesWithoutOwner),
      // Informational: every capability without an owner, not just a
      // critical/essential one — that stricter, higher-stakes case is
      // Assurance's own `essential-no-technical-owner` finding below.
      severity: 'informational',
      browseHref: browseHref('unowned-capabilities'),
    },
    {
      key: 'stale-attributes',
      count: data.staleAttributes.staleFactCount,
      summary:
        data.staleAttributes.staleFactCount > 0
          ? `${String(data.staleAttributes.staleFactCount)} ${plural(data.staleAttributes.staleFactCount, 'attribute', 'attributes')} stale over 12 months — across ${String(data.staleAttributes.staleSystems.length)} ${plural(data.staleAttributes.staleSystems.length, 'system', 'systems')} · oldest ${String(data.staleAttributes.oldestAgeYears)}y`
          : '0 attributes stale over 12 months',
      items: elementItems(data.staleAttributes.staleSystems),
      severity: 'medium',
      browseHref: browseHref('stale-attributes'),
    },
    {
      key: 'unlabeled-relationships',
      count: data.unlabeledVerbRelationships.length,
      summary: `${String(data.unlabeledVerbRelationships.length)} ${plural(data.unlabeledVerbRelationships.length, 'relationship', 'relationships')} missing a label`,
      items: unlabeledRelationshipItems(data.unlabeledVerbRelationships),
      severity: 'medium',
    },
    {
      key: 'no-technical-owner',
      count: data.systemsWithoutTechnicalOwner.length,
      summary: `${String(data.systemsWithoutTechnicalOwner.length)} ${plural(data.systemsWithoutTechnicalOwner.length, 'system', 'systems')} with no technical owner`,
      items: elementItems(data.systemsWithoutTechnicalOwner),
      // Informational: every system, not just one supporting an essential
      // function — that stricter case is `essential-no-technical-owner`
      // below (Assurance), which is high-severity.
      severity: 'informational',
      browseHref: browseHref('no-technical-owner'),
    },
    {
      key: 'critical-no-business-owner',
      count: data.criticalSystemsWithoutBusinessOwner.length,
      summary: `${String(data.criticalSystemsWithoutBusinessOwner.length)} critical ${plural(data.criticalSystemsWithoutBusinessOwner.length, 'system', 'systems')} with no business owner`,
      items: elementItems(data.criticalSystemsWithoutBusinessOwner),
      severity: 'high',
      browseHref: browseHref('critical-no-business-owner'),
    },
    {
      // One of the architect door's three decision-shaped findings
      // (per-item-actions prompt) — a single exposed system gets a direct
      // "Start a decision" on its own card; more than one opens this
      // filtered list instead, where each row carries its own pre-filled
      // action (`resolveCardAction`'s own doc comment).
      key: 'critical-exposed',
      count: data.criticalExposedSystems.length,
      summary: `${String(data.criticalExposedSystems.length)} critical ${plural(data.criticalExposedSystems.length, 'system', 'systems')} exposed with no planned replacement`,
      items: elementItems(data.criticalExposedSystems),
      severity: 'high',
      browseHref: browseHref('critical-exposed'),
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => startDecisionAction(prefillFromCriticalExposedFinding({ id: item.id, name: item.label })) } : {}),
    },
    {
      // Labelling only — a crossing missing its *data classification* is
      // Assurance's own finding below, not this one too (found during a
      // walkthrough: the same crossing showed up twice, once in each
      // section, with near-identical wording — see
      // `findBoundaryCrossingsMissingVerb`'s own doc comment). A missing
      // verb label is a lesser gap than a missing classification, so this
      // stays medium even though both concern the same boundary.
      key: 'boundary-crossings-missing-verb',
      count: data.boundaryCrossingsMissingVerb.length,
      summary: `${String(data.boundaryCrossingsMissingVerb.length)} boundary crossing${data.boundaryCrossingsMissingVerb.length === 1 ? '' : 's'} with no verb label`,
      items: boundaryCrossingItems(data.boundaryCrossingsMissingVerb),
      severity: 'medium',
    },
    {
      key: 'unused-integration-platform',
      count: data.unusedIntegrationPlatforms.length,
      summary: `${String(data.unusedIntegrationPlatforms.length)} unused integration ${plural(data.unusedIntegrationPlatforms.length, 'platform', 'platforms')} (nothing flows via it)`,
      items: elementItems(data.unusedIntegrationPlatforms),
      severity: 'medium',
      browseHref: browseHref('unused-integration-platform'),
      // Integration platform context prompt: "health finding 'integration
      // platform with nothing via it' links here" — a single unused
      // platform's own card goes straight to its (empty) Context diagram
      // rather than the browse table; more than one still falls through to
      // `browseHref` above, since a single link can only point at one page.
      singleItemAction: (item: HealthFindingItem) => ({ href: contextHref(item.id), label: 'View context →' }),
    },
    {
      // The minimal fit-for-purpose finding: structurally close to
      // `critical-exposed` above (a real gap, nothing lined up to replace
      // it, the same "Start a decision" action) but not gated on
      // `criticality: 'critical'`, so it stays medium rather than high — a
      // judgment call, not named in the agreed severity tiers (this check
      // didn't exist when those were agreed).
      key: 'poor-fit-no-replacement',
      count: data.capabilitiesWithPoorFitPrimarySupporter.length,
      summary: `${String(data.capabilitiesWithPoorFitPrimarySupporter.length)} ${plural(data.capabilitiesWithPoorFitPrimarySupporter.length, 'capability', 'capabilities')} whose primary supporter is rated a poor or adequate fit, with no planned replacement`,
      items: elementItems(data.capabilitiesWithPoorFitPrimarySupporter),
      // No `browseHref` — this filter has no browse-table home (same as
      // before this redesign, `itemAction`'s own predecessor never had one
      // either); a multi-item finding here gets no card action at all,
      // only the single-item "Start a decision" case below.
      severity: 'medium',
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => startDecisionAction(prefillFromPoorFitCapabilityFinding({ id: item.id, name: item.label })) } : {}),
    },
    {
      // The architect door's third decision-shaped finding
      // (per-item-actions prompt): a level-1 capability with nothing
      // recorded at all — the same classification the director door's own
      // weak-capability grid already flags (`findCapabilitiesWithNoSupporters`'s
      // own doc comment). Medium, not high, for the same reason
      // `poor-fit-no-replacement` above is medium: a real gap, but not tied
      // to an explicit `criticality: 'critical'` attribute the way
      // `critical-exposed`/`critical-support-end` are.
      key: 'capability-no-supporters',
      count: data.capabilitiesWithNoSupporters.length,
      summary: `${String(data.capabilitiesWithNoSupporters.length)} ${plural(data.capabilitiesWithNoSupporters.length, 'capability', 'capabilities')} with no known supporters`,
      items: elementItems(data.capabilitiesWithNoSupporters),
      severity: 'medium',
      browseHref: browseHref('capability-no-supporters'),
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => startDecisionAction(prefillFromCapabilityNoSupportersFinding({ id: item.id, name: item.label })) } : {}),
    },
  ];
  const { active: activeHealthChecks, clear: clearHealthChecks } = partitionHealthChecks(healthChecks);
  // Item 3: informational findings never sit in the grid — they render as
  // single-line rows beneath it instead (`infoRows` below).
  const gridHealthChecks = activeHealthChecks.filter((c) => c.severity !== 'informational');
  const infoHealthChecks = activeHealthChecks.filter((c) => c.severity === 'informational');

  // Prompt 7k item 5's own three regulatory-alignment checks, plus S1
  // item 11a's own two external-boundary checks — five in all, grouped
  // under "Assurance" (S1 item 6), partitioned the same way as the group
  // above but kept independent of it (a clean Health findings group says
  // nothing about whether Assurance is also clean, and vice versa).
  const assuranceChecks: HealthCheck[] = [
    {
      key: 'essential-no-technical-owner',
      count: data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length,
      summary: `${String(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length)} ${plural(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length, 'system', 'systems')} supporting an essential function with no technical owner`,
      items: elementItems(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner),
      severity: 'high',
      browseHref: browseHref('essential-no-technical-owner'),
    },
    {
      key: 'boundary-crossings-missing-classification',
      count: data.boundaryCrossingsMissingClassification.length,
      summary: `${String(data.boundaryCrossingsMissingClassification.length)} boundary crossing${data.boundaryCrossingsMissingClassification.length === 1 ? '' : 's'} with no data classification`,
      items: boundaryCrossingItems(data.boundaryCrossingsMissingClassification),
      severity: 'high',
    },
    {
      // One of the architect door's three decision-shaped findings — F3's
      // own named "SAP PM" golden path.
      key: 'critical-support-end',
      count: data.criticalSystemsPastOrNearSupportEnd.length,
      summary: `${String(data.criticalSystemsPastOrNearSupportEnd.length)} critical ${plural(data.criticalSystemsPastOrNearSupportEnd.length, 'system', 'systems')} past or near vendor support end`,
      items: elementItems(data.criticalSystemsPastOrNearSupportEnd),
      severity: 'high',
      browseHref: browseHref('critical-support-end'),
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => startDecisionAction(prefillFromCriticalSupportEndFinding({ id: item.id, name: item.label })) } : {}),
    },
    {
      key: 'external-interfaces-missing-classification',
      count: data.externalInterfacesMissingClassification.length,
      summary: `${String(data.externalInterfacesMissingClassification.length)} external interface${data.externalInterfacesMissingClassification.length === 1 ? '' : 's'} with no data classification`,
      items: externalInterfaceItems(data.externalInterfacesMissingClassification),
      severity: 'high',
      browseHref: externalInterfacesHref,
      browseLabel: 'View all →',
    },
    {
      // S1 item 11a: purely informational (see this finding's own doc
      // comment, healthFindings.ts) — still one of the checks for "N
      // checks clear" purposes when nothing external has access at all.
      key: 'external-organisation-access',
      count: data.externalOrganisationAccess.length,
      summary: `${String(data.externalOrganisationAccess.length)} external ${plural(data.externalOrganisationAccess.length, 'organisation', 'organisations')} with access`,
      items: externalOrganisationAccessItems(data.externalOrganisationAccess),
      severity: 'informational',
      browseHref: externalInterfacesHref,
      browseLabel: 'View all →',
    },
  ];
  const { active: activeAssuranceChecks, clear: clearAssuranceChecks } = partitionHealthChecks(assuranceChecks);
  const gridAssuranceChecks = activeAssuranceChecks.filter((c) => c.severity !== 'informational');
  const infoAssuranceChecks = activeAssuranceChecks.filter((c) => c.severity === 'informational');

  // Item 1's own stat row: "findings needing attention" counts active
  // *checks* at high/medium severity — the same unit "N checks clear"
  // already uses (see this component's own module comment for why this,
  // not a sum of raw item counts, is the right number here). Assurance
  // counts every active assurance check regardless of severity — its own
  // informational row (external-organisation-access) is still something
  // worth a director-adjacent glance, unlike Health findings' own
  // informational checks which are folded out of "needing attention".
  const findingsNeedingAttentionCount = gridHealthChecks.length;
  const assuranceItemsCount = activeAssuranceChecks.length;

  function findingGrid(checks: readonly HealthCheck[]) {
    if (checks.length === 0) return null;
    return (
      <div className={styles.findingGrid}>
        {checks.map((check) => (
          <FindingCard key={check.key} count={check.count} summary={check.summary} items={check.items} severity={check.severity} action={resolveCardAction(check)} />
        ))}
      </div>
    );
  }

  // Item 3: "informational findings as single-line rows beneath the
  // grid" — one line each, no card box or tint, but still naming the
  // affected items (truncated the same "and N more" way a grid card's own
  // names line does) and carrying the same inline action a grid card
  // would — the only thing that changes for an informational finding is
  // the chrome, not whether its own names/action are one click away.
  function infoRows(checks: readonly HealthCheck[]) {
    if (checks.length === 0) return null;
    return (
      <div className={styles.infoRows}>
        {checks.map((check) => (
          <Text key={check.key} as="p" size="sm" tone="muted">
            {check.summary}
            {check.items.length > 0 && ` — ${joinWithMore(check.items)}`}
            {check.browseHref !== undefined && (
              <>
                {' · '}
                <Link to={check.browseHref}>
                  <Text as="span" size="sm">
                    {check.browseLabel ?? 'Review →'}
                  </Text>
                </Link>
              </>
            )}
          </Text>
        ))}
      </div>
    );
  }

  function clearChecksSection(checks: readonly HealthCheck[]) {
    if (checks.length === 0) return null;
    return (
      <CollapsibleSection title={checksClearLabel(checks.length)} defaultOpen={false}>
        <div className={styles.infoRows}>
          {checks.map((check) => (
            <Text key={check.key} as="p" tone="muted">
              {check.summary}
            </Text>
          ))}
        </div>
      </CollapsibleSection>
    );
  }

  const { shown: shownActivity, rest: restActivity } = selectRecentActivity(data.recentCommits, 5);

  function activityRow(group: GroupedActivityItem) {
    const { latest, count, subject } = group;
    const diffHref = commitDiffHref(latest.commit);
    // A real, ungrouped commit keeps its own title; a collapsed run gets
    // the synthetic "N edits to X" summary the prompt's own example names
    // ("3 edits to Dynamics") — never both, and never a "1 edit to X" for
    // a group of one (`count > 1` is the only condition that matters here,
    // `subject` is already guaranteed non-null whenever `count > 1` —
    // `groupRecentActivity.ts`'s own collapsing rule).
    const title = truncateTitle(count > 1 && subject ? `${String(count)} edits to ${subject.name}` : latest.commit.title);
    return (
      <li key={group.key} className={styles.commitRow}>
        <div className={styles.commitMain}>
          {diffHref && count === 1 ? (
            <Link to={diffHref}>
              <Text as="span" size="sm">
                {title}
              </Text>
            </Link>
          ) : (
            <Text as="span" size="sm">
              {title}
            </Text>
          )}
          {count === 1 && latest.subjects.length > 0 && (
            <Text as="p" tone="faint" size="xs">
              {latest.subjects.map((s, index) => (
                <Fragment key={s.elementId}>
                  {index > 0 && ', '}
                  <Link to={elementHref(s.elementId)}>{s.name}</Link>
                </Fragment>
              ))}
            </Text>
          )}
          {count > 1 && subject && (
            <Text as="p" tone="faint" size="xs">
              <Link to={elementHref(subject.elementId)}>{subject.name}</Link>
            </Text>
          )}
        </div>
        <div className={styles.commitMeta}>
          <Text as="span" tone="muted" size="sm">
            {latest.authorDisplay}
          </Text>
          <Text as="span" tone="faint" size="sm">
            {formatRelativeTime(latest.commit.created_at, now)}
          </Text>
        </div>
      </li>
    );
  }

  return (
    <div>
      {/* Item 1: the same big-number/muted-label stat style the director
          door's own `.statsRow` uses — see this component's own module
          comment for what each of the four numbers counts and why. */}
      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <Text as="span" size="2xl">
            {data.reviewQueueCount}
          </Text>
          <Text as="span" tone="muted" size="sm">
            review queue
          </Text>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl" className={findingsNeedingAttentionCount > 0 ? styles.statWarn : undefined}>
            {findingsNeedingAttentionCount}
          </Text>
          <Text as="span" tone="muted" size="sm">
            finding{findingsNeedingAttentionCount === 1 ? '' : 's'} needing attention
          </Text>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl" className={assuranceItemsCount > 0 ? styles.statWarn : undefined}>
            {assuranceItemsCount}
          </Text>
          <Text as="span" tone="muted" size="sm">
            assurance item{assuranceItemsCount === 1 ? '' : 's'}
          </Text>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl">
            {data.myOpenBranches.length}
          </Text>
          <Text as="span" tone="muted" size="sm">
            open change{data.myOpenBranches.length === 1 ? '' : 's'} of mine
          </Text>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.main}>
          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Review queue
            </Text>
            {data.oldestReviewItem ? (
              <Link to={`/o/${orgSlug}/m/${modelSlug}/review/${data.oldestReviewItem.id}`}>
                <Text as="span" size="sm">
                  Oldest: opened {formatRelativeTime(data.oldestReviewItem.created_at, now)} →
                </Text>
              </Link>
            ) : (
              <EmptyState>Nothing in review right now.</EmptyState>
            )}
          </Panel>

          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Health findings
            </Text>

            {/* Prompt 7k item 3's own link into BoundaryCrossingsPage.tsx's
                full list. */}
            <Link to={`/o/${orgSlug}/m/${modelSlug}/boundary-crossings`}>
              <Text as="span" tone="muted" size="sm">
                View boundary crossings →
              </Text>
            </Link>

            {findingGrid(gridHealthChecks)}
            {(infoHealthChecks.length > 0 || activeHealthChecks.length > 0) && (
              <div className={styles.infoRows}>
                {infoRows(infoHealthChecks)}
                {/* Not a real check (always 0 until Q1, ADR-019) — never
                    part of `healthChecks` or its "N checks clear" collapse,
                    but kept alongside the other findings rather than shown
                    when every real check is already clean. */}
                {activeHealthChecks.length > 0 && (
                  <Text as="p" tone="faint" size="sm">
                    {data.duplicatesCount} duplicates flagged — wired to 0 until Q1&rsquo;s matching pipeline can populate the standing duplicates report (ADR-019).
                  </Text>
                )}
              </div>
            )}
            {clearChecksSection(clearHealthChecks)}

            {/* Item 5: Assurance keeps its own heading but uses the same
                grid/info-rows shape as Health findings above. */}
            <Text as="h3" size="lg" className={styles.subsectionTitle}>
              Assurance
            </Text>
            {findingGrid(gridAssuranceChecks)}
            {infoRows(infoAssuranceChecks)}
            {clearChecksSection(clearAssuranceChecks)}
          </Panel>
        </div>

        <div className={styles.side}>
          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              My changes
            </Text>
            {data.myOpenBranches.length === 0 ? (
              <EmptyState>No open changes of your own right now.</EmptyState>
            ) : (
              <ul className={styles.branchList}>
                {data.myOpenBranches.map((branch) => (
                  <li key={branch.id} className={styles.branchRow}>
                    <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
                      <Text as="span" size="sm">
                        {branch.title ?? branch.name}
                      </Text>
                    </Link>
                    <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Recent activity
            </Text>
            {data.recentCommits.length === 0 ? (
              <EmptyState>No activity on main yet.</EmptyState>
            ) : (
              <>
                <ul className={styles.commitList}>{shownActivity.map(activityRow)}</ul>
                {restActivity.length > 0 && (
                  <CollapsibleSection title="View all" meta={`(${String(restActivity.length)} more)`} defaultOpen={false}>
                    <ul className={styles.commitList}>{restActivity.map(activityRow)}</ul>
                  </CollapsibleSection>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
