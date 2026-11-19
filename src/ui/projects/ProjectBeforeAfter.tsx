import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { loadProjectHeads } from '../../db/projectHeads';
import type { BranchRow } from '../../db/types';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { buildProjectBeforeAfter, type BeforeAfterColumn, type BeforeAfterMark } from './projectBeforeAfter';
import styles from './ProjectBeforeAfter.module.css';

const OPEN_STATUSES = new Set(['draft', 'proposed', 'in_review', 'approved']);

export interface ProjectBeforeAfterProps {
  modelId: UUID;
  projectId: UUID;
  /** The live model's head commit; nothing to compare without it. */
  mainHeadCommitId: UUID | null;
  /** The project's changes, any stage; only the open ones with their own commits are compared. */
  changes: readonly BranchRow[];
  /** The capabilities in the project's declared scope. */
  capabilities: readonly { id: UUID; name: string }[];
  base: string;
}

function markLabel(mark: BeforeAfterMark): string | null {
  return mark === 'new' ? 'New' : mark === 'ends' ? 'Ends' : null;
}

function Column({ column, base }: { column: BeforeAfterColumn; base: string }) {
  return (
    <div className={styles.column}>
      <Text as="h4" size="md">
        {column.title}
      </Text>
      {column.systems.length === 0 ? (
        <Text as="p" size="sm" tone="muted">
          Nothing we run supports this. A buy or build option is needed.
        </Text>
      ) : (
        <ul className={styles.systems}>
          {column.systems.map((system) => (
            <li key={system.id} className={styles.system}>
              <span className={styles.systemName}>
                <Link to={`${base}/e/${system.id}`}>{system.name}</Link>
                {markLabel(system.mark) !== null && <Chip tone={system.mark === 'new' ? 'ok' : 'warn'}>{markLabel(system.mark)}</Chip>}
                <Link to={`${base}/context/${system.id}?ref=main`}>
                  <Text as="span" size="xs">
                    Context
                  </Text>
                </Link>
              </span>
              {system.connections.length === 0 ? (
                <Text as="p" size="xs" tone="muted">
                  No connected apps or integrations recorded.
                </Text>
              ) : (
                <ul className={styles.connections}>
                  {system.connections.map((c) => (
                    <li key={`${c.key}-${c.mark}`}>
                      <Text as="span" size="sm">
                        {c.label} <Link to={`${base}/e/${c.appId}`}>{c.appName}</Link>
                        {c.isExternal ? ' (external)' : ''}
                      </Text>{' '}
                      {markLabel(c.mark) !== null && <Chip tone={c.mark === 'new' ? 'ok' : 'warn'}>{markLabel(c.mark)}</Chip>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Plan B1: "What this changes, capability by capability" — for each
 * capability in the project's scope, the systems that support it today and
 * after each drafted change, with each system's connected apps and
 * integrations. Derived from the commit history on load, nothing stored.
 */
export function ProjectBeforeAfter({ modelId, projectId, mainHeadCommitId, changes, capabilities, base }: ProjectBeforeAfterProps) {
  const openChanges = changes.filter((c) => OPEN_STATUSES.has(c.status));
  const changeKey = openChanges.map((c) => `${c.id}:${c.head_commit_id}`).join(',');
  const { data } = useQuery({
    queryKey: ['projects', 'beforeAfter', projectId, mainHeadCommitId, changeKey],
    enabled: mainHeadCommitId !== null && capabilities.length > 0,
    queryFn: async () => {
      if (mainHeadCommitId === null) return null;
      const heads = await loadProjectHeads(supabase, modelId, mainHeadCommitId, openChanges);
      return buildProjectBeforeAfter(heads.today, heads.changes, capabilities);
    },
  });

  if (capabilities.length === 0 || !data) return null;

  return (
    <Panel data-testid="project-before-after">
      <Text as="h2" size="lg">
        What this changes, capability by capability
      </Text>
      <Text as="p" size="sm" tone="muted">
        For each capability this project serves: what supports it today, and what would support it after each drafted change, with the apps and integrations each system connects to. Read from the model, not stored.
      </Text>
      {data.map((capability) => (
        <section key={capability.id} className={styles.capability} aria-label={capability.name}>
          <Text as="h3" size="md">
            <Link to={`${base}/e/${capability.id}`}>{capability.name}</Link>
          </Text>
          <div className={styles.columns}>
            <Column column={capability.today} base={base} />
            {capability.after.map((column) => (
              <Column key={column.changeId} column={column} base={base} />
            ))}
          </div>
          {capability.after.length === 0 && (
            <Text as="p" size="sm" tone="muted">
              No change has been drafted yet, so there is no “after” to compare.
            </Text>
          )}
        </section>
      ))}
    </Panel>
  );
}
