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
import { monthsSince } from '../../contracts/thresholds';
import type { BoundaryCrossing, UnlabeledVerbRelationship } from '../../db/healthFindings';
import { branchStatusTone } from '../changes/branchStatus';
import { formatCommitActivityTime } from './commitActivityTime';
import { selectRecentActivity, type GroupedActivityItem } from './groupRecentActivity';
import { checksClearLabel, partitionHealthChecks, type HealthCheck } from './healthChecks';
import type { ArchitectHomeData, RecentCommitRow } from './useArchitectHome';
import styles from './DoorHome.module.css';

export interface ArchitectHomeProps {
  data: ArchitectHomeData;
  orgSlug: string;
  modelSlug: string;
}

/** Same age vocabulary as `HistoryTimeline`'s own local `formatAge` — `< 1mo ago` / `Nmo ago` / `Ny ago`. */
function formatAge(dateStr: string, now: Date): string {
  const months = monthsSince(new Date(dateStr), now);
  if (months < 1) return '< 1mo ago';
  if (months < 24) return `${String(months)}mo ago`;
  return `${String(Math.floor(months / 12))}y ago`;
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

/**
 * The architect's door (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment for Health findings —
 * `docs/HANDOFF-7d-architect-door.md`; still scoped down from §3.2's full
 * three-column dashboard otherwise, see `useArchitectHome.ts`'s own
 * comment for exactly what's deferred).
 *
 * S1 item 6: "Architect door order: review queue, health findings
 * (boundary crossings and Assurance inside), my changes, recent
 * activity." Boundary crossings' own count-and-link block (Prompt 7k
 * item 3, the full list still lives at `BoundaryCrossingsPage.tsx`) and
 * the Assurance sub-group (Prompt 7k item 5's three regulatory-alignment
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
 */
export function ArchitectHome({ data, orgSlug, modelSlug }: ArchitectHomeProps) {
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
      browseHref: browseHref('unlinked-systems'),
      browseLabel: 'Review and link →',
    },
    {
      key: 'unowned-capabilities',
      count: data.capabilitiesWithoutOwner.length,
      summary: `${String(data.capabilitiesWithoutOwner.length)} ${plural(data.capabilitiesWithoutOwner.length, 'capability', 'capabilities')} with no owner`,
      items: elementItems(data.capabilitiesWithoutOwner),
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
      browseHref: browseHref('stale-attributes'),
    },
    {
      key: 'unlabeled-relationships',
      count: data.unlabeledVerbRelationships.length,
      summary: `${String(data.unlabeledVerbRelationships.length)} ${plural(data.unlabeledVerbRelationships.length, 'relationship', 'relationships')} missing a label`,
      items: unlabeledRelationshipItems(data.unlabeledVerbRelationships),
    },
    {
      key: 'no-technical-owner',
      count: data.systemsWithoutTechnicalOwner.length,
      summary: `${String(data.systemsWithoutTechnicalOwner.length)} ${plural(data.systemsWithoutTechnicalOwner.length, 'system', 'systems')} with no technical owner`,
      items: elementItems(data.systemsWithoutTechnicalOwner),
      browseHref: browseHref('no-technical-owner'),
    },
    {
      key: 'critical-no-business-owner',
      count: data.criticalSystemsWithoutBusinessOwner.length,
      summary: `${String(data.criticalSystemsWithoutBusinessOwner.length)} critical ${plural(data.criticalSystemsWithoutBusinessOwner.length, 'system', 'systems')} with no business owner`,
      items: elementItems(data.criticalSystemsWithoutBusinessOwner),
      browseHref: browseHref('critical-no-business-owner'),
    },
    {
      key: 'critical-exposed',
      count: data.criticalExposedSystems.length,
      summary: `${String(data.criticalExposedSystems.length)} critical ${plural(data.criticalExposedSystems.length, 'system', 'systems')} exposed with no planned replacement`,
      items: elementItems(data.criticalExposedSystems),
      browseHref: browseHref('critical-exposed'),
    },
    {
      key: 'boundary-crossings-missing-metadata',
      count: data.boundaryCrossingsMissingClassificationOrVerb.length,
      summary: `${String(data.boundaryCrossingsMissingClassificationOrVerb.length)} boundary crossing${data.boundaryCrossingsMissingClassificationOrVerb.length === 1 ? '' : 's'} with no data classification or verb`,
      items: boundaryCrossingItems(data.boundaryCrossingsMissingClassificationOrVerb),
    },
    {
      key: 'unused-integration-platform',
      count: data.unusedIntegrationPlatforms.length,
      summary: `${String(data.unusedIntegrationPlatforms.length)} unused integration ${plural(data.unusedIntegrationPlatforms.length, 'platform', 'platforms')} (nothing flows via it)`,
      items: elementItems(data.unusedIntegrationPlatforms),
      browseHref: browseHref('unused-integration-platform'),
    },
  ];
  const { active: activeHealthChecks, clear: clearHealthChecks } = partitionHealthChecks(healthChecks);

  // Prompt 7k item 5's own three regulatory-alignment checks — grouped
  // under "Assurance" (S1 item 6), partitioned the same way as the group
  // above but kept independent of it (a clean Health findings group says
  // nothing about whether Assurance is also clean, and vice versa).
  const assuranceChecks: HealthCheck[] = [
    {
      key: 'essential-no-technical-owner',
      count: data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length,
      summary: `${String(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length)} ${plural(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner.length, 'system', 'systems')} supporting an essential function with no technical owner`,
      items: elementItems(data.systemsSupportingEssentialFunctionWithoutTechnicalOwner),
      browseHref: browseHref('essential-no-technical-owner'),
    },
    {
      key: 'boundary-crossings-missing-classification',
      count: data.boundaryCrossingsMissingClassification.length,
      summary: `${String(data.boundaryCrossingsMissingClassification.length)} boundary crossing${data.boundaryCrossingsMissingClassification.length === 1 ? '' : 's'} with no data classification`,
      items: boundaryCrossingItems(data.boundaryCrossingsMissingClassification),
    },
    {
      key: 'critical-support-end',
      count: data.criticalSystemsPastOrNearSupportEnd.length,
      summary: `${String(data.criticalSystemsPastOrNearSupportEnd.length)} critical ${plural(data.criticalSystemsPastOrNearSupportEnd.length, 'system', 'systems')} past or near vendor support end`,
      items: elementItems(data.criticalSystemsPastOrNearSupportEnd),
      browseHref: browseHref('critical-support-end'),
    },
  ];
  const { active: activeAssuranceChecks, clear: clearAssuranceChecks } = partitionHealthChecks(assuranceChecks);

  function checkPlate(check: HealthCheck, index: number) {
    const browseProps = check.browseHref !== undefined ? { browseHref: check.browseHref, ...(check.browseLabel !== undefined && { browseLabel: check.browseLabel }) } : {};
    const finding = <HealthFinding summary={check.summary} items={check.items} {...browseProps} />;
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
            {formatCommitActivityTime(latest.commit.created_at, now)}
          </Text>
        </div>
      </li>
    );
  }

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <Panel>
          <Text as="h2" size="lg">
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
                Oldest: opened {formatAge(data.oldestReviewItem.created_at, now)} →
              </Text>
            </Link>
          )}
        </Panel>

        <Panel>
          <Text as="h2" size="lg">
            Health findings
          </Text>

          {/* Prompt 7k item 3's own count-and-link block — every IT/OT
              crossing, not just the ones a finding below flags as missing
              metadata; the full list still lives at BoundaryCrossingsPage.tsx.
              S1 item 6 moves this from its own standalone panel to inside
              Health findings, first. */}
          <div className={styles.count}>
            <Text as="span" size="2xl">
              {data.boundaryCrossingsCount}
            </Text>
            <Text as="span" tone="muted" size="sm">
              IT/OT crossing{data.boundaryCrossingsCount === 1 ? '' : 's'}
            </Text>
          </div>
          <Link to={`/o/${orgSlug}/m/${modelSlug}/boundary-crossings`}>
            <Text as="span" size="sm">
              View all →
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
          <Text as="h3" size="md">
            Assurance
          </Text>
          {activeAssuranceChecks.length > 0 && <div className={styles.findingPlates}>{activeAssuranceChecks.map(checkPlate)}</div>}
          {clearChecksSection(clearAssuranceChecks)}
        </Panel>
      </div>

      <div className={styles.side}>
        <Panel>
          <Text as="h2" size="lg">
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
          <Text as="h2" size="lg">
            Recent activity
          </Text>
          {data.recentCommits.length === 0 ? (
            <EmptyState>No commits on main yet.</EmptyState>
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
