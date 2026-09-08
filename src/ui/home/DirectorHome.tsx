import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { branchStatusTone } from '../changes/branchStatus';
import { CapabilityMapThumbnail } from './CapabilityMapThumbnail';
import type { DirectorHomeData } from './useDirectorHome';
import styles from './DoorHome.module.css';

export interface DirectorHomeProps {
  data: DirectorHomeData;
  orgSlug: string;
  modelSlug: string;
}

/**
 * The director's door (UI-principles §3.1, scoped down for Sprint U3b —
 * see src/db/modelHome.ts's own module comment for the full-vs-built
 * gap). Capability map thumbnail with exposure tone; counts; changes in
 * flight by status; the last three versions. No sidebar, no branch
 * selector, no editing affordance (§3.1) — every link here either opens
 * the real capability map/changes/versions pages or a change's own page,
 * never an inline edit.
 */
export function DirectorHome({ data, orgSlug, modelSlug }: DirectorHomeProps) {
  const capabilityMapHref = `/o/${orgSlug}/m/${modelSlug}/capability-map`;

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <Panel>
          <Text as="h2" size="lg">
            Capability map
          </Text>
          <CapabilityMapThumbnail tree={data.tree} exposureTone={data.exposureTone} capabilityMapHref={capabilityMapHref} />
        </Panel>

        <Panel>
          <Text as="h2" size="lg">
            At a glance
          </Text>
          <div className={styles.counts}>
            <Count label="Capabilities" value={data.counts.capabilities} />
            <Count label="Systems" value={data.counts.systems} />
            <Count label="Open changes" value={data.counts.openChanges} />
          </div>
        </Panel>
      </div>

      <div className={styles.side}>
        <Panel>
          <Text as="h2" size="lg">
            Changes in flight
          </Text>
          {data.changesInFlight.length === 0 ? (
            <EmptyState>Nothing in flight right now.</EmptyState>
          ) : (
            <div className={styles.changeGroups}>
              {data.changesInFlight.map((group) => (
                <div key={group.status} className={styles.changeGroup}>
                  <Chip tone={branchStatusTone(group.status)}>
                    {group.status} ({group.branches.length})
                  </Chip>
                  <ul className={styles.changeList}>
                    {group.branches.map((branch) => (
                      <li key={branch.id}>
                        <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
                          <Text as="span" size="sm">
                            {branch.title ?? branch.name}
                          </Text>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <Text as="h2" size="lg">
            Recent versions
          </Text>
          {data.recentVersions.length === 0 ? (
            <EmptyState>No versions tagged yet.</EmptyState>
          ) : (
            <ul className={styles.versionList}>
              {data.recentVersions.map((tag) => (
                <li key={tag.id}>
                  <Link to={`/o/${orgSlug}/m/${modelSlug}/capability-map?ref=tag:${tag.name}`}>
                    <Text as="span" size="sm">
                      {tag.name}
                    </Text>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to={`/o/${orgSlug}/m/${modelSlug}/versions`}>
            <Text as="span" tone="muted" size="sm">
              All versions →
            </Text>
          </Link>
        </Panel>
      </div>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.count}>
      <Text as="span" size="2xl">
        {value}
      </Text>
      <Text as="span" tone="muted" size="sm">
        {label}
      </Text>
    </div>
  );
}
