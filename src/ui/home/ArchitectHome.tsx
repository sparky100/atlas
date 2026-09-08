import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
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

/**
 * The architect's door (UI-principles §3.2, scoped down for Sprint U3b —
 * see src/db/modelHome.ts's own module comment for the full-vs-built
 * gap). Recent commits on main; the review queue's count and oldest item;
 * the signed-in user's own open branches; the duplicates count ADR-019
 * names for Q1, wired to 0 until then. Jumping to Changes or the review
 * queue generically is the persistent model nav's job now (ModelNav.tsx)
 * — this used to also carry its own "Start a change"/"Open the queue"
 * links before that existed.
 */
export function ArchitectHome({ data, orgSlug, modelSlug }: ArchitectHomeProps) {
  const now = new Date();

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
            Duplicates
          </Text>
          <div className={styles.count}>
            <Text as="span" size="2xl">
              {data.duplicatesCount}
            </Text>
            <Text as="span" tone="muted" size="sm">
              flagged
            </Text>
          </div>
          <Text as="p" tone="faint" size="sm">
            Wired to 0 until Q1&rsquo;s matching pipeline can populate the standing duplicates report (ADR-019).
          </Text>
        </Panel>
      </div>
    </div>
  );
}
