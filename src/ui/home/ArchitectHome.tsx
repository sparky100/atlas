import { HomeViewLink } from './HomeViewLink';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { FindingCard, type FindingCardAction } from '../components/HealthFinding/FindingCard';
import { joinWithMore, type HealthFindingItem } from '../components/HealthFinding/healthFindingFormat';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { describeLifecycleMismatch } from '../../engine/elementRead/lifecycleDateMismatch';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow, MemberRole } from '../../db/types';
import type { BoundaryCrossing, ExternalInterfaceCrossing, ExternalOrganisationAccess, PlatformFlowEndpoint, UnlabeledVerbRelationship } from '../../db/healthFindings';
import { formatDate, formatRelativeTime } from '../time';
import { formatProjectProgress, projectStatusLabel, projectStatusTone, projectsWaitingForAcceptance } from '../projects/projectModel';
import { useAuth } from '../auth/useAuth';
import { branchStatusTone } from '../changes/branchStatus';
import { buildMyWorkRows, decisionOptions, myWorkDetail, projectChildren } from './myWork';
import {
  decisionPrefillToSearchParams,
  prefillFromCriticalExposedFinding,
  prefillFromSystemWithoutCapability,
  prefillFromCriticalSupportEndFinding,
  prefillFromOutgoingDisposition,
  type DecisionPrefill,
} from '../decisions/decisionPrefill';
import { canStartDecision } from '../orgs/useMembership';
import { GoalsWithoutCapabilityNote } from '../goals/GoalsWithoutCapabilityNote';
import { PrincipleDeparturesNote } from '../principles/PrincipleDeparturesNote';
import { attributesRecord } from '../elements/attributesRecord';
import { canAcceptProject, canStartProject } from '../orgs/roleGates';
import { useOrganisationBySlug } from '../orgs/useOrganisationBySlug';
import { canOfferDesigner, designerUnavailableReason } from '../decisions/designerRequest';
import { selectRecentActivity, splitActivitySubjects, type GroupedActivityItem } from './groupRecentActivity';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';
import { MissingFactsStat } from '../gaps/MissingFactsStat';
import type { ArchitectHomeData } from './useArchitectHome';
import type { ArchitectHomeInsightsState, RecentCommitRow } from './useArchitectHomeInsights';
import styles from './DoorHome.module.css';

/** A commit's named subjects: the first few as links, the rest behind a "+N more" toggle so a bulk import doesn't dump hundreds of names into Home. */
function ActivitySubjects({ subjects, elementHref }: { subjects: { elementId: string; name: string }[]; elementHref: (elementId: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden } = splitActivitySubjects(subjects);
  const shown = expanded ? subjects : visible;
  return (
    <Text as="p" tone="faint" size="xs">
      {shown.map((s, index) => (
        <Fragment key={s.elementId}>
          {index > 0 && ', '}
          <Link to={elementHref(s.elementId)}>{s.name}</Link>
        </Fragment>
      ))}
      {hidden.length > 0 && (
        <>
          {' '}
          <button type="button" aria-expanded={expanded} onClick={() => { setExpanded((v) => !v); }} className={styles.moreToggle}>
            {expanded ? 'Show fewer' : `+${String(hidden.length)} more`}
          </button>
        </>
      )}
    </Text>
  );
}

export interface ArchitectHomeProps {
  data: ArchitectHomeData;
  modelId: string;
  /** Main's head commit, so the missing-facts count doesn't re-resolve it. */
  mainCommitIdHint?: string | null | undefined;
  /** E8 item (4): Health findings and Recent activity load after first paint, in their own state machine (`useArchitectHomeInsights.ts`) — this component renders `data`'s Review-queue/My-changes panels regardless of this state, and shows a muted "Loading…" in place of the two panels that need it. */
  insights: ArchitectHomeInsightsState;
  /** Gates every "Start a decision →" card action below (`canStartDecision`) — omitted entirely, not shown disabled, for a viewer. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
  /** Switches Home to Overview — UI-principles §3's one-home-per-finding rule: capability weakness lives on Overview, so this door links across to it rather than repeating it. */
  onShowOverview: () => void;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** `ElementsHeadRow[]` → `HealthFindingItem[]` — every element-shaped finding's items are just names (the browse-table/decision link is the actionable part, per-item actions having moved to the browse table's own rows). */
function elementItems(elements: readonly ElementsHeadRow[]): HealthFindingItem[] {
  return elements.map((el) => ({ id: el.element_id, label: el.name, elementId: el.element_id }));
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
 *    assurance items / my open changes / duplicates flagged — F4 added the
 *    fifth), the same big-number/muted-label style the director door's own
 *    `.statsRow` already uses — this replaces the standalone "Review queue"
 *    panel's own oversized count, which now duplicates into one of these
 *    numbers instead.
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
export function ArchitectHome({ data, modelId, mainCommitIdHint, insights, role, orgSlug, modelSlug, onShowOverview }: ArchitectHomeProps) {
  // The Designer lives one click on, in a decision started from a finding. Say so here, so it can be found from where the findings are (Simon, 2026-11-19).
  const { organisation } = useOrganisationBySlug(orgSlug);
  const designerArgs = { role, assistantEnabled: organisation?.ai_assistant_enabled === true, agentsEnabled: organisation?.ai_agents_enabled === true, keySet: organisation?.ai_agent_key_set === true };
  const designerOffered = canOfferDesigner(designerArgs);
  const designerWhyNot = designerUnavailableReason(designerArgs);
  const now = new Date();
  const { userId: homeUserId } = useAuth();
  const waitingProjects = projectsWaitingForAcceptance(data.allProjects, canAcceptProject(role), homeUserId);
  // E8 item (4): `null` while Health findings/Recent activity are still
  // loading (or failed) — every array below built from it defaults to
  // empty in that case, and the panels that show them render a muted
  // "Loading…" instead, rather than an empty/misleadingly-clear state.
  const insightsData = insights.status === 'ready' ? insights.data : null;
  const myWorkRows = buildMyWorkRows(data.myOpenBranches, data.allDecisions, data.allProjects, data.optionLinks);
  // Three sections, in this order, nothing listed twice (Simon, 2026-11-19): projects (with their decisions and changes inside), decisions outside a project, changes outside both.
  const ownedDecisionsOutside = data.myOwnedWork.decisions.filter(({ projectTitle }) => projectTitle === null);
  const standaloneChangeRows = myWorkRows.filter((row) => row.kind === 'change');
  const modelHref = `/o/${orgSlug}/m/${modelSlug}`;
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
    // F10 step 7 (ADR-024 §6.4): the same finding can start a project
    // instead — same prefill params, the project form reads them too.
    ...(canStartProject(role) ? { also: { href: `/o/${orgSlug}/m/${modelSlug}/projects?${decisionPrefillToSearchParams(prefill).toString()}`, label: 'Start a project →' } } : {}),
  });
  // F4 (ADR-019 "Amended (F4, ...)"): the architect door's own link into the
  // standing duplicates report.
  const duplicatesHref = `/o/${orgSlug}/m/${modelSlug}/duplicates`;

  // F4 (ADR-019 "Amended (F4, ...)"): `duplicatesCount` is real now — the
  // standing duplicates report's own open-candidate count. Still left out
  // of this list (it isn't a `HealthCheck` — no browse-table home, no
  // severity) and rendered as its own stat/link below instead.
  const healthChecks: HealthCheck[] = !insightsData
    ? []
    : [
    {
      key: 'unlinked-systems',
      count: insightsData.systemsWithoutCapability.length,
      summary: `${String(insightsData.systemsWithoutCapability.length)} ${plural(insightsData.systemsWithoutCapability.length, 'system', 'systems')} not linked to a capability`,
      items: elementItems(insightsData.systemsWithoutCapability),
      severity: 'medium',
      browseHref: browseHref('unlinked-systems'),
      browseLabel: 'Review and link →',
      // A2: one system → straight to a decision on keep / link / retire
      // (retirement as an option to investigate). Several → the browse list.
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => ({ ...startDecisionAction(prefillFromSystemWithoutCapability({ id: item.id, name: item.label })), label: 'Keep, link or retire? →' }) } : {}),
    },
    {
      // S1 item 19: purely informational (see this finding's own doc
      // comment, healthFindings.ts) — the platform already counts as
      // linked either way (findSystemsWithoutCapability above already
      // credits a module's own supports edge), this only nudges that the
      // edge's likely home is one level down.
      key: 'platform-supports-move-to-module',
      count: insightsData.platformSupportsThatShouldMoveToModule.length,
      summary: `${String(insightsData.platformSupportsThatShouldMoveToModule.length)} platform ${insightsData.platformSupportsThatShouldMoveToModule.length === 1 ? 'link' : 'links'} that could move to a module`,
      items: elementItems(insightsData.platformSupportsThatShouldMoveToModule),
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
      count: insightsData.flowsToPlatformInsteadOfModule.length,
      summary: `${String(insightsData.flowsToPlatformInsteadOfModule.length)} flow${insightsData.flowsToPlatformInsteadOfModule.length === 1 ? '' : 's'} that could point at a module instead of the platform`,
      items: platformFlowEndpointItems(insightsData.flowsToPlatformInsteadOfModule),
      severity: 'medium',
    },
    {
      key: 'unowned-capabilities',
      count: insightsData.capabilitiesWithoutOwner.length,
      summary: `${String(insightsData.capabilitiesWithoutOwner.length)} ${plural(insightsData.capabilitiesWithoutOwner.length, 'capability', 'capabilities')} with no owner`,
      items: elementItems(insightsData.capabilitiesWithoutOwner),
      // Informational: every capability without an owner, not just a
      // critical/essential one — that stricter, higher-stakes case is
      // Assurance's own `essential-no-technical-owner` finding below.
      severity: 'informational',
      browseHref: browseHref('unowned-capabilities'),
    },
    {
      key: 'stale-attributes',
      count: insightsData.staleAttributes.staleElements.length,
      summary: `${String(insightsData.staleAttributes.staleElements.length)} ${plural(insightsData.staleAttributes.staleElements.length, 'item', 'items')} not checked for over ${String(insightsData.staleAfterMonths)} months`,
      items: elementItems(insightsData.staleAttributes.staleElements),
      severity: 'medium',
      browseHref: browseHref('stale-attributes'),
      browseLabel: 'Check them →',
    },
    {
      // Status and dates must tell the same story. The one-click fix sits on each row of the filtered list the card opens.
      key: 'lifecycle-date-mismatch',
      count: insightsData.lifecycleDateMismatches.length,
      summary: `${String(insightsData.lifecycleDateMismatches.length)} ${plural(insightsData.lifecycleDateMismatches.length, 'system or module has', 'systems or modules have')} a status that doesn't match ${insightsData.lifecycleDateMismatches.length === 1 ? 'its' : 'their'} dates`,
      items: insightsData.lifecycleDateMismatches.map((m) => ({ id: m.element.element_id, label: `${m.element.name}: ${describeLifecycleMismatch(m).replace(/^M/, 'm')}`, elementId: m.element.element_id })),
      severity: 'medium',
      browseHref: browseHref('lifecycle-date-mismatch'),
      browseLabel: 'Review and fix →',
    },
    {
      key: 'unlabeled-relationships',
      count: insightsData.unlabeledVerbRelationships.length,
      summary: `${String(insightsData.unlabeledVerbRelationships.length)} ${plural(insightsData.unlabeledVerbRelationships.length, 'relationship', 'relationships')} missing a label`,
      items: unlabeledRelationshipItems(insightsData.unlabeledVerbRelationships),
      severity: 'medium',
    },
    {
      key: 'no-technical-owner',
      count: insightsData.systemsWithoutTechnicalOwner.length,
      summary: `${String(insightsData.systemsWithoutTechnicalOwner.length)} ${plural(insightsData.systemsWithoutTechnicalOwner.length, 'system', 'systems')} with no technical owner`,
      items: elementItems(insightsData.systemsWithoutTechnicalOwner),
      // Informational: every system, not just one supporting an essential
      // function — that stricter case is `essential-no-technical-owner`
      // below (Assurance), which is high-severity.
      severity: 'informational',
      browseHref: browseHref('no-technical-owner'),
    },
    {
      key: 'ai-agent-no-technical-owner',
      count: insightsData.aiAgentsWithoutTechnicalOwner.length,
      summary: `${String(insightsData.aiAgentsWithoutTechnicalOwner.length)} AI ${plural(insightsData.aiAgentsWithoutTechnicalOwner.length, 'agent', 'agents')} that act alone with no technical owner`,
      items: elementItems(insightsData.aiAgentsWithoutTechnicalOwner),
      severity: 'high',
      browseHref: browseHref('ai-agent-no-technical-owner'),
    },
    {
      key: 'critical-no-business-owner',
      count: insightsData.criticalSystemsWithoutBusinessOwner.length,
      summary: `${String(insightsData.criticalSystemsWithoutBusinessOwner.length)} critical ${plural(insightsData.criticalSystemsWithoutBusinessOwner.length, 'system', 'systems')} with no business owner`,
      items: elementItems(insightsData.criticalSystemsWithoutBusinessOwner),
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
      count: insightsData.criticalExposedSystems.length,
      summary: `${String(insightsData.criticalExposedSystems.length)} critical ${plural(insightsData.criticalExposedSystems.length, 'system', 'systems')} exposed with no planned replacement`,
      items: elementItems(insightsData.criticalExposedSystems),
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
      count: insightsData.boundaryCrossingsMissingVerb.length,
      summary: `${String(insightsData.boundaryCrossingsMissingVerb.length)} boundary crossing${insightsData.boundaryCrossingsMissingVerb.length === 1 ? '' : 's'} with no verb label`,
      items: boundaryCrossingItems(insightsData.boundaryCrossingsMissingVerb),
      severity: 'medium',
    },
    {
      key: 'unused-integration-platform',
      count: insightsData.unusedIntegrationPlatforms.length,
      summary: `${String(insightsData.unusedIntegrationPlatforms.length)} unused integration ${plural(insightsData.unusedIntegrationPlatforms.length, 'platform', 'platforms')} (nothing flows via it)`,
      items: elementItems(insightsData.unusedIntegrationPlatforms),
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
      // ADR-026: the interface-level twin of the finding above.
      key: 'unused-integration-interface',
      count: insightsData.unusedIntegrationInterfaces.length,
      summary: `${String(insightsData.unusedIntegrationInterfaces.length)} integration ${plural(insightsData.unusedIntegrationInterfaces.length, 'interface', 'interfaces')} with nothing flowing via ${plural(insightsData.unusedIntegrationInterfaces.length, 'it', 'them')}`,
      items: elementItems(insightsData.unusedIntegrationInterfaces),
      severity: 'medium',
      browseHref: browseHref('unused-integration-interface'),
      singleItemAction: (item: HealthFindingItem) => ({ href: contextHref(item.id), label: 'View context →' }),
    },
    {
      // F11: a recorded Migrate/Eliminate with no open change retiring it.
      // Each item names the open project already scoped to it, and its one
      // action opens that project — or starts one when there is none.
      key: 'outgoing-no-retiring-change',
      count: insightsData.outgoingWithoutRetiringChange.length,
      summary: `${String(insightsData.outgoingWithoutRetiringChange.length)} ${plural(insightsData.outgoingWithoutRetiringChange.length, 'system', 'systems')} planned to move or switch off with no open change retiring ${insightsData.outgoingWithoutRetiringChange.length === 1 ? 'it' : 'them'}`,
      items: insightsData.outgoingWithoutRetiringChange.map((el) => {
        const project = insightsData.projectByElementId.get(el.element_id);
        return { id: el.element_id, label: project ? `${el.name} (project: ${project.projectTitle})` : el.name };
      }),
      severity: 'medium',
      browseHref: browseHref('outgoing-no-retiring-change'),
      singleItemAction: (item: HealthFindingItem): FindingCardAction => {
        const project = insightsData.projectByElementId.get(item.id);
        if (project) return { href: `/o/${orgSlug}/m/${modelSlug}/projects/${project.projectId}`, label: `Open ${project.projectTitle} →` };
        const element = insightsData.outgoingWithoutRetiringChange.find((el) => el.element_id === item.id);
        const disposition = element ? attributesRecord(element.attributes).disposition : undefined;
        const prefill = prefillFromOutgoingDisposition({ id: item.id, name: element?.name ?? item.label }, disposition === 'eliminate' ? 'eliminate' : 'migrate');
        return canStartProject(role)
          ? { href: `/o/${orgSlug}/m/${modelSlug}/projects?${decisionPrefillToSearchParams(prefill).toString()}`, label: 'Start a project →' }
          : { href: `/o/${orgSlug}/m/${modelSlug}/e/${item.id}`, label: 'View →' };
      },
    },
    {
      // A1b: an open project whose declared scope names no capability — the
      // gap A1a's form guard prevents at creation, surfaced for projects
      // made before it. Each item is the project itself (its id, not an
      // element id, so the names line stays plain text); the one action
      // opens the project, where the derived capabilities can be added in
      // one click.
      key: 'project-no-capability',
      count: insightsData.projectsWithoutCapability.length,
      summary: `${String(insightsData.projectsWithoutCapability.length)} ${plural(insightsData.projectsWithoutCapability.length, 'project', 'projects')} not tied to a capability`,
      items: insightsData.projectsWithoutCapability.map((p) => ({ id: p.projectId, label: p.projectTitle })),
      severity: 'medium',
      // No elements-browse home — a project isn't an element; for more than
      // one, the card's action opens the Projects list instead.
      browseHref: `/o/${orgSlug}/m/${modelSlug}/projects`,
      browseLabel: 'Review projects →',
      singleItemAction: (item: HealthFindingItem): FindingCardAction => ({ href: `/o/${orgSlug}/m/${modelSlug}/projects/${item.id}`, label: `Open ${item.label} →` }),
    },
    {
      // Phase B: a decision recorded a date to look at it again, and that date has come. The reconsider-if statements sit on the decision itself.
      key: 'decisions-due-for-review',
      count: insightsData.decisionsDueForReview.length,
      summary: `${String(insightsData.decisionsDueForReview.length)} ${plural(insightsData.decisionsDueForReview.length, 'decision', 'decisions')} due to be looked at again`,
      items: insightsData.decisionsDueForReview.map((d) => ({ id: d.decisionId, label: d.title })),
      severity: 'medium',
      browseHref: `/o/${orgSlug}/m/${modelSlug}/decisions`,
      browseLabel: 'Review decisions →',
      singleItemAction: (item: HealthFindingItem): FindingCardAction => ({ href: `/o/${orgSlug}/m/${modelSlug}/decisions/${item.id}`, label: `Open ${item.label} →` }),
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
  const assuranceChecks: HealthCheck[] = !insightsData
    ? []
    : [
    {
      key: 'essential-no-technical-owner',
      count: insightsData.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length,
      summary: `${String(insightsData.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length)} ${plural(insightsData.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length, 'system', 'systems')} supporting an essential function with no technical owner`,
      items: elementItems(insightsData.systemsSupportingEssentialFunctionWithoutTechnicalOwner),
      severity: 'high',
      browseHref: browseHref('essential-no-technical-owner'),
    },
    {
      key: 'boundary-crossings-missing-classification',
      count: insightsData.boundaryCrossingsMissingClassification.length,
      summary: `${String(insightsData.boundaryCrossingsMissingClassification.length)} boundary crossing${insightsData.boundaryCrossingsMissingClassification.length === 1 ? '' : 's'} with no data classification`,
      items: boundaryCrossingItems(insightsData.boundaryCrossingsMissingClassification),
      severity: 'high',
    },
    {
      // One of the architect door's three decision-shaped findings — F3's
      // own named "SAP PM" golden path.
      key: 'critical-support-end',
      count: insightsData.criticalSystemsPastOrNearSupportEnd.length,
      summary: `${String(insightsData.criticalSystemsPastOrNearSupportEnd.length)} critical ${plural(insightsData.criticalSystemsPastOrNearSupportEnd.length, 'system', 'systems')} past or near vendor support end`,
      items: elementItems(insightsData.criticalSystemsPastOrNearSupportEnd),
      severity: 'high',
      browseHref: browseHref('critical-support-end'),
      ...(canStartDecision(role) ? { singleItemAction: (item: HealthFindingItem) => startDecisionAction(prefillFromCriticalSupportEndFinding({ id: item.id, name: item.label })) } : {}),
    },
    {
      key: 'external-interfaces-missing-classification',
      count: insightsData.externalInterfacesMissingClassification.length,
      summary: `${String(insightsData.externalInterfacesMissingClassification.length)} external interface${insightsData.externalInterfacesMissingClassification.length === 1 ? '' : 's'} with no data classification`,
      items: externalInterfaceItems(insightsData.externalInterfacesMissingClassification),
      severity: 'high',
      browseHref: externalInterfacesHref,
      browseLabel: 'View all →',
    },
    {
      // S1 item 11a: purely informational (see this finding's own doc
      // comment, healthFindings.ts) — still one of the checks for "N
      // checks clear" purposes when nothing external has access at all.
      key: 'external-organisation-access',
      count: insightsData.externalOrganisationAccess.length,
      summary: `${String(insightsData.externalOrganisationAccess.length)} external ${plural(insightsData.externalOrganisationAccess.length, 'organisation', 'organisations')} with access`,
      items: externalOrganisationAccessItems(insightsData.externalOrganisationAccess),
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
          <FindingCard key={check.key} count={check.count} summary={check.summary} items={check.items} severity={check.severity} action={resolveCardAction(check)} elementHref={(id) => `/o/${orgSlug}/m/${modelSlug}/e/${id}`} />
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

  const { shown: shownActivity, rest: restActivity } = selectRecentActivity(insightsData?.recentCommits ?? [], 5);

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
            <ActivitySubjects subjects={latest.subjects} elementHref={elementHref} />
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
      {waitingProjects > 0 ? (
        <div data-testid="projects-waiting-for-you">
          <Text as="p">
            <Link to={`${modelHref}/projects`}>
              {waitingProjects === 1 ? '1 project is waiting for you to accept it →' : `${String(waitingProjects)} projects are waiting for you to accept them →`}
            </Link>
          </Text>
        </div>
      ) : null}
      {/* Item 1: the same big-number/muted-label stat style the director
          door's own `.statsRow` uses — see this component's own module
          comment for what each of the four numbers counts and why. */}
      <div className={styles.statsRow}>
        {/* F9 step 2: a link into the queue, like the duplicates stat below —
            the queue stopped being its own nav item (it's a tab of
            Changes now), so this is the door's one-click way in. */}
        <div className={styles.stat}>
          <Link to={`/o/${orgSlug}/m/${modelSlug}/review`}>
            <Text as="span" size="2xl">
              {data.reviewQueueCount}
            </Text>{' '}
            <Text as="span" tone="muted" size="sm">
              review queue
            </Text>
          </Link>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl" className={insightsData && findingsNeedingAttentionCount > 0 ? styles.statWarn : undefined}>
            {insightsData ? findingsNeedingAttentionCount : '…'}
          </Text>{' '}
          <Text as="span" tone="muted" size="sm">
            finding{findingsNeedingAttentionCount === 1 ? '' : 's'} needing attention
          </Text>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl" className={insightsData && assuranceItemsCount > 0 ? styles.statWarn : undefined}>
            {insightsData ? assuranceItemsCount : '…'}
          </Text>{' '}
          <Text as="span" tone="muted" size="sm">
            assurance item{assuranceItemsCount === 1 ? '' : 's'}
          </Text>
        </div>
        <div className={styles.stat}>
          <Text as="span" size="2xl">
            {data.myOpenBranches.length}
          </Text>{' '}
          <Text as="span" tone="muted" size="sm">
            open change{data.myOpenBranches.length === 1 ? '' : 's'} of mine
          </Text>
        </div>
        {/* F4 (ADR-019 "Amended (F4, ...)"): the fifth stat — the standing
            duplicates report's own open-candidate count, real from here on
            (previously a permanent "wired to 0" placeholder line below the
            grid instead of a stat at all). */}
        <MissingFactsStat modelId={modelId} mainCommitIdHint={mainCommitIdHint ?? null} orgSlug={orgSlug} modelSlug={modelSlug} className={styles.stat} />
        <div className={styles.stat}>
          <Link to={duplicatesHref}>
            <Text as="span" size="2xl" className={insightsData && insightsData.duplicatesCount > 0 ? styles.statWarn : undefined}>
              {insightsData ? insightsData.duplicatesCount : '…'}
            </Text>{' '}
            <Text as="span" tone="muted" size="sm">
              duplicate{insightsData?.duplicatesCount === 1 ? '' : 's'} flagged
            </Text>
          </Link>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.main}>
          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Waiting for review
            </Text>
            {data.overdueReviews[0] && data.reviewPeriodDays !== null && (
              <p>
                <Chip tone="warn">Overdue</Chip>{' '}
                <Link to={`/o/${orgSlug}/m/${modelSlug}/review/${data.overdueReviews[0].id}`}>
                  <Text as="span" size="sm">
                    {data.overdueReviews.length} {plural(data.overdueReviews.length, 'review', 'reviews')} waiting longer than {data.reviewPeriodDays} days — oldest first →
                  </Text>
                </Link>
              </p>
            )}
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

          <GoalsWithoutCapabilityNote modelId={modelId} goalsHref={`${modelHref}/goals`} />
          <PrincipleDeparturesNote modelId={modelId} principlesHref={`${modelHref}/principles`} />

          {/* UI-principles §3 (2026-10-04, step 3): what's waiting on this
              user as an owner — their open decisions (overdue first) and
              the projects they're accountable for. In the main column,
              straight after the review queue, so a phone (where the side
              column stacks last) reaches them before the health findings. */}
          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              My projects
            </Text>
            {data.myOwnedWork.projects.length === 0 ? (
              <EmptyState>No projects of yours in hand.</EmptyState>
            ) : (
              <ul className={styles.branchList} aria-label="My projects">
                {data.myOwnedWork.projects.map(({ project, progress, overdueDecisions }) => (
                  <li key={project.id} className={styles.ownedRow}>
                    <div className={styles.branchRow}>
                      <Link to={`${modelHref}/projects/${project.id}`}>
                        <Text as="span" size="sm">
                          {project.title}
                        </Text>
                      </Link>
                      {project.status !== 'active' && <Chip tone={projectStatusTone(project.status)}>{projectStatusLabel(project.status)}</Chip>}
                      {overdueDecisions > 0 && (
                        <Link to={`${modelHref}/projects/${project.id}`}>
                          <Chip tone="warn">{`${String(overdueDecisions)} ${overdueDecisions === 1 ? 'decision' : 'decisions'} overdue`}</Chip>
                        </Link>
                      )}
                    </div>
                    <Text as="p" tone="muted" size="xs">
                      {project.target_date !== null ? `target ${formatDate(project.target_date)} · ` : ''}
                      {formatProjectProgress(progress)}
                    </Text>
                    <ProjectChildren modelHref={modelHref} children={projectChildren(project.id, data.allOpenBranches, data.allDecisions, data.optionLinks)} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              My decisions
            </Text>
            {ownedDecisionsOutside.length === 0 ? (
              <EmptyState>No open decisions of yours.</EmptyState>
            ) : (
              <ul className={styles.branchList} aria-label="My decisions">
                {ownedDecisionsOutside.map(({ decision, overdue, projectTitle }) => (
                  <li key={decision.id} className={styles.ownedRow}>
                    <div className={styles.branchRow}>
                      <Link to={`${modelHref}/decisions/${decision.id}`}>
                        <Text as="span" size="sm">
                          {decision.title}
                        </Text>
                      </Link>
                      {overdue && <Chip tone="warn">overdue</Chip>}
                    </div>
                    {(decision.needed_by !== null || projectTitle !== null) && (
                      <Text as="p" tone="muted" size="xs">
                        {[decision.needed_by !== null ? `needed by ${formatDate(decision.needed_by)}` : null, projectTitle !== null ? `in ${projectTitle}` : null].filter((part): part is string => part !== null).join(' · ')}
                      </Text>
                    )}
                    <OptionList modelHref={modelHref} options={decisionOptions(decision.id, data.allOpenBranches, data.optionLinks)} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              My changes
            </Text>
            {standaloneChangeRows.length === 0 ? (
              <EmptyState>No open changes of yours outside a decision or project.</EmptyState>
            ) : (
              <ul className={styles.branchList} data-testid="my-work-list">
                {standaloneChangeRows.map((row) => (
                  <li key={row.key} className={styles.ownedRow}>
                    <div className={styles.branchRow}>
                      <Link to={`${modelHref}/${row.target.kind === 'project' ? 'projects' : row.target.kind === 'decision' ? 'decisions' : 'changes'}/${row.target.id}`}>
                        <Text as="span" size="sm">
                          {row.title}
                        </Text>
                      </Link>
                      {row.status !== null && <Chip tone={branchStatusTone(row.status)}>{row.status}</Chip>}
                    </div>
                    <Text as="p" tone="muted" size="xs">
                      {myWorkDetail(row)}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel data-testid="health-findings-panel">
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
            {/* UI-principles §3: where capabilities are weak is Overview's to show, not repeated here. */}
            <HomeViewLink onClick={onShowOverview}>Where capabilities are weak is on Overview →</HomeViewLink>
            {canStartDecision(role) && organisation !== null && (
              <div data-testid="designer-hint">
                <Text as="p" tone="muted" size="sm">
                  {designerOffered
                    ? 'The Designer can draft options for a finding: choose "Start a decision →" on it, then "Draft options with the Designer".'
                    : (designerWhyNot?.text ?? '')}{' '}
                  {!designerOffered && designerWhyNot?.canFix === true && <Link to={`/o/${orgSlug}/settings`}>Open organisation settings</Link>}
                </Text>
              </div>
            )}

            {/* E8 item (4): Health findings load after first paint
                (`useArchitectHomeInsights.ts`) — everything below reads
                `insightsData`, so it's all gated on that being ready. */}
            {insights.status === 'error' ? (
              <Text as="p" tone="muted" size="sm">
                {insights.message}
              </Text>
            ) : !insightsData ? (
              <Text as="p" tone="muted" size="sm">
                Loading…
              </Text>
            ) : (
              <>
                {findingGrid(gridHealthChecks)}
                {infoHealthChecks.length > 0 && <div className={styles.infoRows}>{infoRows(infoHealthChecks)}</div>}
                {clearChecksSection(clearHealthChecks)}

                {/* Item 5: Assurance keeps its own heading but uses the same
                    grid/info-rows shape as Health findings above. */}
                <Text as="h3" size="lg" className={styles.subsectionTitle}>
                  Assurance
                </Text>
                {findingGrid(gridAssuranceChecks)}
                {infoRows(infoAssuranceChecks)}
                {clearChecksSection(clearAssuranceChecks)}
              </>
            )}
          </Panel>
        </div>

        <div className={styles.side}>
          <Panel>
            <Text as="h2" size="xl" className={styles.sectionTitle}>
              Recent activity
            </Text>
            {/* E8 item (4): loads after first paint, same as Health findings above. */}
            {insights.status === 'error' ? (
              <Text as="p" tone="muted" size="sm">
                {insights.message}
              </Text>
            ) : !insightsData ? (
              <Text as="p" tone="muted" size="sm">
                Loading…
              </Text>
            ) : insightsData.recentCommits.length === 0 ? null : (
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

/** The option changes of one decision, each a link, one level below it. */
function OptionList({ modelHref, options }: { modelHref: string; options: BranchRow[] }) {
  if (options.length === 0) return null;
  return (
    <ul className={styles.branchList} aria-label="Options">
      {options.map((c) => (
        <li key={c.id}>
          <Link to={`${modelHref}/changes/${c.id}`}>
            <Text as="span" size="xs">
              {c.title ?? c.name}
            </Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What sits inside a project: its decisions (each with its option changes beneath), and changes linked straight to the project at the same level as the decisions. */
function ProjectChildren({ modelHref, children }: { modelHref: string; children: ReturnType<typeof projectChildren> }) {
  if (children.decisions.length === 0 && children.changes.length === 0) return null;
  return (
    <ul className={styles.branchList} aria-label="Inside this project">
      {children.decisions.map(({ decision, options }) => (
        <li key={decision.id}>
          <Text as="span" size="xs" tone="muted">
            Decision:{' '}
          </Text>
          <Link to={`${modelHref}/decisions/${decision.id}`}>
            <Text as="span" size="xs">
              {decision.title}
            </Text>
          </Link>
          <OptionList modelHref={modelHref} options={options} />
        </li>
      ))}
      {children.changes.map((c) => (
        <li key={c.id}>
          <Text as="span" size="xs" tone="muted">
            Change:{' '}
          </Text>
          <Link to={`${modelHref}/changes/${c.id}`}>
            <Text as="span" size="xs">
              {c.title ?? c.name}
            </Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}
