import { Fragment } from 'react';
import { Link } from 'react-router';
import { BlueprintFrame } from '../components/BlueprintFrame/BlueprintFrame';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { HealthFinding, type HealthFindingItem } from '../components/HealthFinding/HealthFinding';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { MemberRole } from '../../db/types';
import type { BoundaryCrossing, ExternalInterfaceCrossing, ExternalOrganisationAccess, PlatformFlowEndpoint, UnlabeledVerbRelationship } from '../../db/healthFindings';
import { formatRelativeTime } from '../time';
import { branchStatusTone } from '../changes/branchStatus';
import { decisionPrefillToSearchParams, prefillFromCriticalSupportEndFinding } from '../decisions/decisionPrefill';
import { StartDecisionLink } from '../decisions/StartDecisionLink';
import { canStartDecision } from '../orgs/useMembership';
import { selectRecentActivity, type GroupedActivityItem } from './groupRecentActivity';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';
import type { ArchitectHomeData, RecentCommitRow } from './useArchitectHome';
import styles from './DoorHome.module.css';

export interface ArchitectHomeProps {
  data: ArchitectHomeData;
  /** Prompt pack F3 PR6: gates the "Start a decision →" row action on the `critical-support-end` finding below (`canStartDecision`) — omitted entirely, not shown disabled, for a viewer. */
  role: MemberRole | null;
  orgSlug: string;
  modelSlug: string;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** `ElementsHeadRow[]` → `HealthFindingItem[]` — every element-shaped finding's items are just names linking nowhere special (the row itself isn't a link; `HealthFinding`'s own browse link is the actionable part now, Sprint U4-1 B3). */
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

/**
 * The architect's door (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment for Health findings —
 * `docs/HANDOFF-7d-architect-door.md`; still scoped down from §3.2's full
 * three-column dashboard otherwise, see `useArchitectHome.ts`'s own
 * comment for exactly what's deferred).
 *
 * S1 item 6: "Architect door order: review queue, health findings
 * (boundary crossings and Assurance inside), my changes, recent
 * activity." Boundary crossings' own link (Prompt 7k item 3, the full list
 * still lives at `BoundaryCrossingsPage.tsx` — Sprint U4-1 findings
 * follow-up dropped this block's own count, which named one specific
 * finding as if it summarised the whole panel; each finding below already
 * states its own count) and the Assurance sub-group (Prompt 7k item 5's
 * three regulatory-alignment
 * findings) now render *inside* the one "Health findings" panel, in that
 * order, rather than as three separate side-by-side panels each gating
 * "No findings" independently. "Recent commits" is renamed "Recent
 * activity" and moved after "My changes" — see `groupRecentActivity.ts`
 * for the "five items, others' activity preferred, runs on one subject
 * collapsed" behaviour that panel now has.
 *
 * The two-column layout itself (`.main`/`.side`, `DoorHome.module.css`)
 * is unchanged, but which content each div holds has swapped: the first
 * div (2fr, wider) now holds Review queue + Health findings; the second
 * (1fr) holds My changes + Recent activity. Below the 768px breakpoint
 * the grid collapses to one column with no `order` overrides anywhere, so
 * this is also what makes the *mobile* stacking order match the prompt's
 * own sequence exactly — the actual reason this swap was worth making,
 * not just a cosmetic desktop rearrangement.
 *
 * Every real finding is still rendered through `HealthFinding` (Sprint
 * U4-1 B3: collapsed row → expand, paginated at 20, a link into the browse
 * table pre-filtered to the finding where one applies). S1 item 7: "zero-
 * count findings collapse to one line ('N checks clear') with expand" —
 * `healthChecks.ts`'s `partitionHealthChecks` splits each group's checks
 * into `active` (its own plate, as before) and `clear` (rolled into one
 * `checksClearLabel` line via `CollapsibleSection`, expanding to each
 * cleared check's own one-line summary). This also replaces the old
 * "No findings" line: when every check in a group is zero, `active` is
 * empty and only the "N checks clear" line renders — the same shape,
 * naturally, rather than a separate special case.
 *
 * S1 item 8: "Review queue and every other user-facing time use the one
 * time helper" — the Review queue's own "Oldest: opened…" line and every
 * commit row in Recent activity now go through `formatRelativeTime`
 * (`src/ui/time.ts`, moved and renamed from this file's old local import
 * of `commitActivityTime.ts`'s `formatCommitActivityTime`), not a local
 * reimplementation. This also swaps Review queue's own vocabulary: it
 * used the coarse provenance staleness bucket before ("< 1mo ago" for
 * anything under a month, which is most review items) —
 * `formatRelativeTime`'s precise minutes/hours answer is what "how old is
 * the oldest item" actually wants. See `src/ui/time.ts`'s own doc comment
 * for why its three vocabularies stay distinct rather than collapsing
 * into one literal format string.
 */
export function ArchitectHome({ data, role, orgSlug, modelSlug }: ArchitectHomeProps) {
  const now = new Date();
  const elementHref = (elementId: string) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}`;
  // Prompt pack F3 PR6: "Start a decision" — the finding's own click hands
  // the Decisions list a pre-filled form (`decisionPrefill.ts`), carried as
  // ordinary URL search params on the `/decisions` link itself.
  const startDecisionHref = (prefill: ReturnType<typeof prefillFromCriticalSupportEndFinding>) => `/o/${orgSlug}/m/${modelSlug}/decisions?${decisionPrefillToSearchParams(prefill).toString()}`;
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

  // `duplicatesCount` is typed as the literal `0` (still wired to 0 until
  // Q1, ADR-019) — a placeholder notice, not a real check yet, so it's
  // left out of this list and rendered as its own permanent line below
  // rather than something item 7's "N checks clear" could ever roll it into.
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
      key: 'critical-exposed',
      count: data.criticalExposedSystems.length,
      summary: `${String(data.criticalExposedSystems.length)} critical ${plural(data.criticalExposedSystems.length, 'system', 'systems')} exposed with no planned replacement`,
      items: elementItems(data.criticalExposedSystems),
      severity: 'high',
      browseHref: browseHref('critical-exposed'),
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
    },
  ];
  const { active: activeHealthChecks, clear: clearHealthChecks } = partitionHealthChecks(healthChecks);

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
      key: 'critical-support-end',
      count: data.criticalSystemsPastOrNearSupportEnd.length,
      summary: `${String(data.criticalSystemsPastOrNearSupportEnd.length)} critical ${plural(data.criticalSystemsPastOrNearSupportEnd.length, 'system', 'systems')} past or near vendor support end`,
      items: elementItems(data.criticalSystemsPastOrNearSupportEnd),
      severity: 'high',
      browseHref: browseHref('critical-support-end'),
      // Prompt pack F3 PR6: "Start a decision" from a health finding —
      // F3's own named "SAP PM" golden path. `item.label` is exactly the
      // system's own name for this finding (`elementItems`, above), so no
      // second lookup is needed to build the prefill. Conditionally spread,
      // not `undefined` — `exactOptionalPropertyTypes` (tsconfig.json)
      // treats an explicit `itemAction: undefined` differently from the
      // key being absent, the same reason `browseProps` below already
      // spreads rather than sets its own optional fields to `undefined`.
      ...(canStartDecision(role)
        ? { itemAction: (item: HealthFindingItem) => <StartDecisionLink href={startDecisionHref(prefillFromCriticalSupportEndFinding({ id: item.id, name: item.label }))} /> }
        : {}),
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
      // comment, healthFindings.ts) — still one of the nine/twelve checks
      // for "N checks clear" purposes when nothing external has access at
      // all, the same as every other check here; nothing about it being
      // informational rather than a problem changes how it collapses. Now
      // also its own severity tier, for the same reason — informational.
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

  function checkPlate(check: HealthCheck, index: number) {
    const browseProps = check.browseHref !== undefined ? { browseHref: check.browseHref, ...(check.browseLabel !== undefined && { browseLabel: check.browseLabel }) } : {};
    const itemActionProps = check.itemAction !== undefined ? { itemAction: check.itemAction } : {};
    const finding = <HealthFinding summary={check.summary} items={check.items} severity={check.severity} {...browseProps} {...itemActionProps} />;
    // Item 6's convention: the first *real* (non-zero) finding in a group
    // is blueprint-framed — preserved here now that zero-count checks no
    // longer take a plate of their own to be "first".
    return index === 0 ? (
      <BlueprintFrame key={check.key}>{finding}</BlueprintFrame>
    ) : (
      <div key={check.key} className={styles.findingPlate}>
        {finding}
      </div>
    );
  }

  function clearChecksSection(checks: readonly HealthCheck[]) {
    if (checks.length === 0) return null;
    return (
      <CollapsibleSection title={checksClearLabel(checks.length)} defaultOpen={false}>
        <div className={styles.findingPlates}>
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
    const title = count > 1 && subject ? `${String(count)} edits to ${subject.name}` : latest.commit.title;
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
    <div className={styles.columns}>
      <div className={styles.main}>
        <Panel>
          <Text as="h2" size="xl" className={styles.sectionTitle}>
            Review queue
          </Text>
          <div className={styles.count}>
            <Text as="span" size="2xl">
              {data.reviewQueueCount}
            </Text>
            <Text as="span" tone="muted" size="sm">
              open request{data.reviewQueueCount === 1 ? '' : 's'}
            </Text>
          </div>
          {data.oldestReviewItem && (
            <Link to={`/o/${orgSlug}/m/${modelSlug}/review/${data.oldestReviewItem.id}`}>
              <Text as="span" size="sm">
                Oldest: opened {formatRelativeTime(data.oldestReviewItem.created_at, now)} →
              </Text>
            </Link>
          )}
        </Panel>

        <Panel>
          <Text as="h2" size="xl" className={styles.sectionTitle}>
            Health findings
          </Text>

          {/* Prompt 7k item 3's own link into BoundaryCrossingsPage.tsx's
              full list. Sprint U4-1 findings follow-up: this used to also
              carry its own "N IT/OT crossings in this model" count, which
              named one specific finding as if it summarised every finding
              in this panel — dropped entirely (each finding below already
              states its own count inline); a bare link to the full list is
              all that's left of Prompt 7k item 3's original block. */}
          <Link to={`/o/${orgSlug}/m/${modelSlug}/boundary-crossings`}>
            <Text as="span" tone="muted" size="sm">
              View boundary crossings →
            </Text>
          </Link>

          {activeHealthChecks.length > 0 && (
            <div className={styles.findingPlates}>
              {activeHealthChecks.map(checkPlate)}
              {/* Not a real check (always 0 until Q1, ADR-019) — never part
                  of `healthChecks` or its "N checks clear" collapse, but
                  kept alongside the other plates rather than shown when
                  every real check is already clean (Sprint U4-1 B3's own
                  "No findings" behaviour, unchanged by S1 item 7). */}
              <div className={styles.findingPlate}>
                <Text as="p">{data.duplicatesCount} duplicates flagged</Text>
                <Text as="p" tone="faint" size="sm">
                  Wired to 0 until Q1&rsquo;s matching pipeline can populate the standing duplicates report (ADR-019).
                </Text>
              </div>
            </div>
          )}
          {clearChecksSection(clearHealthChecks)}

          {/* S1 item 6: "Assurance inside" — Prompt 7k item 5's own three
              regulatory-alignment findings, still gated by their own
              independent zero-check (a clean Health findings panel above
              says nothing about whether Assurance also has nothing to
              show, and vice versa), now a subsection of this one panel
              rather than a standalone Panel of its own. */}
          <Text as="h3" size="lg" className={styles.subsectionTitle}>
            Assurance
          </Text>
          {activeAssuranceChecks.length > 0 && <div className={styles.findingPlates}>{activeAssuranceChecks.map(checkPlate)}</div>}
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
  );
}
