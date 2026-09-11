import { Fragment } from 'react';
import { Link } from 'react-router';
import { BlueprintFrame } from '../components/BlueprintFrame/BlueprintFrame';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { HealthFinding, type HealthFindingItem } from '../components/HealthFinding/HealthFinding';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { ElementsHeadRow } from '../../contracts/rows';
import { monthsSince } from '../../contracts/thresholds';
import type { UnlabeledVerbRelationship } from '../../db/healthFindings';
import { branchStatusTone } from '../changes/branchStatus';
import { formatCommitActivityTime } from './commitActivityTime';
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

/**
 * The architect's door (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment for Health findings —
 * `docs/HANDOFF-7d-architect-door.md`; still scoped down from §3.2's full
 * three-column dashboard otherwise, see `useArchitectHome.ts`'s own
 * comment for exactly what's deferred). Recent commits on main; the
 * review queue's count and oldest item; the signed-in user's own open
 * branches; five health findings (systems with no capability,
 * capabilities with no owner, stale attributes, `uses`/`flows_to`
 * relationships with no verb-phrase label (Sprint U4-1 B5), duplicates —
 * the last still wired to 0 until Q1, ADR-019), each rendered through
 * `HealthFinding` (Sprint U4-1 B3: collapsed row → expand, paginated at
 * 20, a link into the browse table pre-filtered to the finding where one
 * applies) — collapsing to a single "No findings" line when every one of
 * them is zero at once. Jumping to Changes or the review
 * queue generically is the persistent model nav's job now (ModelNav.tsx)
 * — this used to also carry its own "Start a change"/"Open the queue"
 * links before that existed.
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

  // Sprint U4-1 B3: "zero-count findings collapse to one 'No findings'
  // line" — checked across every real finding. `duplicatesCount` is typed
  // as the literal `0` (still wired to 0 until Q1, ADR-019), so it's
  // trivially always satisfied and left out of this check rather than
  // written as a tautological `=== 0`.
  const allFindingsZero =
    data.systemsWithoutCapability.length === 0 &&
    data.capabilitiesWithoutOwner.length === 0 &&
    data.staleAttributes.staleFactCount === 0 &&
    data.unlabeledVerbRelationships.length === 0 &&
    data.systemsWithoutTechnicalOwner.length === 0 &&
    data.criticalSystemsWithoutBusinessOwner.length === 0 &&
    data.criticalExposedSystems.length === 0;

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <Panel>
          <Text as="h2" size="lg">
            Recent commits
          </Text>
          {data.recentCommits.length === 0 ? (
            <EmptyState>No commits on main yet.</EmptyState>
          ) : (
            <ul className={styles.commitList}>
              {data.recentCommits.map(({ commit, authorDisplay, subjects }) => {
                const diffHref = commitDiffHref(commit);
                return (
                  <li key={commit.id} className={styles.commitRow}>
                    <div className={styles.commitMain}>
                      {diffHref ? (
                        <Link to={diffHref}>
                          <Text as="span" size="sm">
                            {commit.title}
                          </Text>
                        </Link>
                      ) : (
                        <Text as="span" size="sm">
                          {commit.title}
                        </Text>
                      )}
                      {subjects.length > 0 && (
                        <Text as="p" tone="faint" size="xs">
                          {subjects.map((subject, index) => (
                            <Fragment key={subject.elementId}>
                              {index > 0 && ', '}
                              <Link to={elementHref(subject.elementId)}>{subject.name}</Link>
                            </Fragment>
                          ))}
                        </Text>
                      )}
                    </div>
                    <div className={styles.commitMeta}>
                      <Text as="span" tone="muted" size="sm">
                        {authorDisplay}
                      </Text>
                      <Text as="span" tone="faint" size="sm">
                        {formatCommitActivityTime(commit.created_at, now)}
                      </Text>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <Text as="h2" size="lg">
            My branches
          </Text>
          {data.myOpenBranches.length === 0 ? (
            <EmptyState>No open branches of your own right now.</EmptyState>
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
      </div>

      <div className={styles.side}>
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
          {allFindingsZero ? (
            <Text as="p" tone="muted">
              No findings.
            </Text>
          ) : (
            <div className={styles.findingPlates}>
              <BlueprintFrame>
                <HealthFinding
                  summary={`${String(data.systemsWithoutCapability.length)} ${plural(data.systemsWithoutCapability.length, 'system', 'systems')} not linked to a capability`}
                  items={elementItems(data.systemsWithoutCapability)}
                  browseHref={browseHref('unlinked-systems')}
                  browseLabel="Review and link →"
                />
              </BlueprintFrame>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={`${String(data.capabilitiesWithoutOwner.length)} ${plural(data.capabilitiesWithoutOwner.length, 'capability', 'capabilities')} with no owner`}
                  items={elementItems(data.capabilitiesWithoutOwner)}
                  browseHref={browseHref('unowned-capabilities')}
                />
              </div>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={
                    data.staleAttributes.staleFactCount > 0
                      ? `${String(data.staleAttributes.staleFactCount)} ${plural(data.staleAttributes.staleFactCount, 'attribute', 'attributes')} stale over 12 months — across ${String(data.staleAttributes.staleSystems.length)} ${plural(data.staleAttributes.staleSystems.length, 'system', 'systems')} · oldest ${String(data.staleAttributes.oldestAgeYears)}y`
                      : '0 attributes stale over 12 months'
                  }
                  items={elementItems(data.staleAttributes.staleSystems)}
                  browseHref={browseHref('stale-attributes')}
                />
              </div>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={`${String(data.unlabeledVerbRelationships.length)} ${plural(data.unlabeledVerbRelationships.length, 'relationship', 'relationships')} missing a label`}
                  items={unlabeledRelationshipItems(data.unlabeledVerbRelationships)}
                />
              </div>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={`${String(data.systemsWithoutTechnicalOwner.length)} ${plural(data.systemsWithoutTechnicalOwner.length, 'system', 'systems')} with no technical owner`}
                  items={elementItems(data.systemsWithoutTechnicalOwner)}
                  browseHref={browseHref('no-technical-owner')}
                />
              </div>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={`${String(data.criticalSystemsWithoutBusinessOwner.length)} critical ${plural(data.criticalSystemsWithoutBusinessOwner.length, 'system', 'systems')} with no business owner`}
                  items={elementItems(data.criticalSystemsWithoutBusinessOwner)}
                  browseHref={browseHref('critical-no-business-owner')}
                />
              </div>

              <div className={styles.findingPlate}>
                <HealthFinding
                  summary={`${String(data.criticalExposedSystems.length)} critical ${plural(data.criticalExposedSystems.length, 'system', 'systems')} exposed with no planned replacement`}
                  items={elementItems(data.criticalExposedSystems)}
                  browseHref={browseHref('critical-exposed')}
                />
              </div>

              <div className={styles.findingPlate}>
                <Text as="p">{data.duplicatesCount} duplicates flagged</Text>
                <Text as="p" tone="faint" size="sm">
                  Wired to 0 until Q1&rsquo;s matching pipeline can populate the standing duplicates report (ADR-019).
                </Text>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
