import { Link } from 'react-router';
import { BlueprintFrame } from '../components/BlueprintFrame/BlueprintFrame';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { ElementsHeadRow } from '../../contracts/rows';
import { monthsSince } from '../../contracts/thresholds';
import { branchStatusTone } from '../changes/branchStatus';
import type { ArchitectHomeData } from './useArchitectHome';
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

/** Handoff 7d's "names three plus +N" — every named-examples list in the Health findings panel uses this, so a finding is actionable from its own row without a click. */
function namedExamples(items: readonly ElementsHeadRow[], max = 3): string {
  const shown = items.slice(0, max).map((item) => item.name);
  const remaining = items.length - shown.length;
  return remaining > 0 ? `${shown.join(', ')}, +${String(remaining)}` : shown.join(', ');
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * The architect's door (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment for Health findings —
 * `docs/HANDOFF-7d-architect-door.md`; still scoped down from §3.2's full
 * three-column dashboard otherwise, see `useArchitectHome.ts`'s own
 * comment for exactly what's deferred). Recent commits on main; the
 * review queue's count and oldest item; the signed-in user's own open
 * branches; four health findings (systems with no capability,
 * capabilities with no owner, stale attributes, duplicates — the last
 * still wired to 0 until Q1, ADR-019). Jumping to Changes or the review
 * queue generically is the persistent model nav's job now (ModelNav.tsx)
 * — this used to also carry its own "Start a change"/"Open the queue"
 * links before that existed.
 */
export function ArchitectHome({ data, orgSlug, modelSlug }: ArchitectHomeProps) {
  const now = new Date();
  const elementsHref = `/o/${orgSlug}/m/${modelSlug}/elements`;

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
              {data.recentCommits.map((commit) => (
                <li key={commit.id} className={styles.commitRow}>
                  <Text as="span" size="sm">
                    {commit.message}
                  </Text>
                  <Text as="span" tone="faint" size="sm">
                    {formatAge(commit.created_at, now)}
                  </Text>
                </li>
              ))}
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
          <div className={styles.findingPlates}>
            <BlueprintFrame>
              <Text as="p">
                {data.systemsWithoutCapability.length} {plural(data.systemsWithoutCapability.length, 'system', 'systems')} not linked to a capability
              </Text>
              {data.systemsWithoutCapability.length > 0 && (
                <>
                  <Text as="p" tone="muted" size="sm">
                    {namedExamples(data.systemsWithoutCapability)}
                  </Text>
                  <Link to={elementsHref}>
                    <Text as="span" size="sm">
                      Review and link →
                    </Text>
                  </Link>
                </>
              )}
            </BlueprintFrame>

            <div className={styles.findingPlate}>
              <Text as="p">
                {data.capabilitiesWithoutOwner.length} {plural(data.capabilitiesWithoutOwner.length, 'capability', 'capabilities')} with no owner
              </Text>
              {data.capabilitiesWithoutOwner.length > 0 && (
                <Text as="p" tone="muted" size="sm">
                  {namedExamples(data.capabilitiesWithoutOwner, data.capabilitiesWithoutOwner.length)}
                </Text>
              )}
            </div>

            <div className={styles.findingPlate}>
              <Text as="p">
                {data.staleAttributes.staleFactCount} {plural(data.staleAttributes.staleFactCount, 'attribute', 'attributes')} stale over 12 months
              </Text>
              {data.staleAttributes.staleFactCount > 0 && (
                <Text as="p" tone="muted" size="sm">
                  across {data.staleAttributes.systemCount} {plural(data.staleAttributes.systemCount, 'system', 'systems')} · oldest {data.staleAttributes.oldestAgeYears}y
                </Text>
              )}
            </div>

            <div className={styles.findingPlate}>
              <Text as="p">{data.duplicatesCount} duplicates flagged</Text>
              <Text as="p" tone="faint" size="sm">
                Wired to 0 until Q1&rsquo;s matching pipeline can populate the standing duplicates report (ADR-019).
              </Text>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
