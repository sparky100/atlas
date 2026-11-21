import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { loadProjectHeads } from '../../db/projectHeads';
import type { BranchRow, DecisionRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { ProjectStep } from './ProjectStep';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { buildProjectBeforeAfter, splitBySystemScope, type BeforeAfterColumn, type BeforeAfterMark, type BeforeAfterSystem } from './projectBeforeAfterModel';
import { ProjectDiagram } from './ProjectDiagram';
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
  /** The systems the project's declared scope names. */
  scopeSystemIds: ReadonlySet<UUID>;
  /** The project's decisions, so the option columns can name where they come from. */
  decisions: readonly DecisionRow[];
  base: string;
  /** Within an accepted decision, without another project-level panel or accordion. */
  embedded?: boolean;
}

function markLabel(mark: BeforeAfterMark): string | null {
  return mark === 'new' ? 'New' : mark === 'ends' ? 'Ends' : null;
}

function SystemList({ systems, base }: { systems: readonly BeforeAfterSystem[]; base: string }) {
  return (
    <ul className={styles.systems}>
      {systems.map((system) => (
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
  );
}

function Column({ column, base, scopeSystemIds }: { column: BeforeAfterColumn; base: string; scopeSystemIds: ReadonlySet<UUID> }) {
  const { inProject, alsoSupports } = splitBySystemScope(column.systems, scopeSystemIds);
  return (
    <div className={styles.column}>
      <Text as="h4" size="md">
        {column.title}
      </Text>
      {column.systems.length === 0 && (
        <Text as="p" size="sm" tone="muted">
          Nothing we run supports this. A buy or build option is needed.
        </Text>
      )}
      {column.systems.length > 0 && inProject.length === 0 && (
        <Text as="p" size="sm" tone="muted">
          No system is named in this project yet.
        </Text>
      )}
      {inProject.length > 0 && <SystemList systems={inProject} base={base} />}
      {alsoSupports.length > 0 && (
        <details className={styles.also} data-testid="also-supports">
          <summary>
            <Text as="span" size="sm" tone="muted">
              Also supports this capability, not in this project ({alsoSupports.length})
            </Text>
          </summary>
          <SystemList systems={alsoSupports} base={base} />
        </details>
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
export function ProjectBeforeAfter({ modelId, projectId, mainHeadCommitId, changes, capabilities, scopeSystemIds, decisions, base, embedded = false }: ProjectBeforeAfterProps) {
  const [view, setView] = useState<'list' | 'diagram'>('list');
  const openChanges = changes.filter((c) => OPEN_STATUSES.has(c.status));
  const changeKey = openChanges.map((c) => `${c.id}:${c.head_commit_id}`).join(',');
  const { data, isPending, isError } = useQuery({
    queryKey: ['projects', 'beforeAfter', projectId, mainHeadCommitId, changeKey],
    enabled: mainHeadCommitId !== null && capabilities.length > 0,
    queryFn: async () => {
      if (mainHeadCommitId === null) return null;
      const heads = await loadProjectHeads(supabase, modelId, mainHeadCommitId, openChanges);
      return buildProjectBeforeAfter(heads.today, heads.changes, capabilities);
    },
  });

  if (capabilities.length === 0) return null;
  if (isError) return <Text as="p" size="sm">Could not load this comparison. Open the change to inspect it.</Text>;
  if (isPending || !data) return <Text as="p" size="sm" tone="muted">Loading the chosen option…</Text>;
  const shownChangeIds = new Set(data.flatMap((c) => c.after.map((col) => col.changeId)));
  const omitted = openChanges.filter((c) => !shownChangeIds.has(c.id));

  const content = (
    <>
      <Text as="p" size="sm" tone="muted">
        This compares the live model with this chosen option only. It does not combine separate decisions.
      </Text>
      {!embedded && decisions.length > 0 && (
        <Text as="p" size="sm" tone="muted">
          The options come from {decisions.length === 1 ? 'the decision' : 'the decisions'}{' '}
          {decisions.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ', ' : ''}
              <Link to={`${base}/decisions/${d.id}`}>{d.title}</Link>
            </span>
          ))}
          .
        </Text>
      )}
      {omitted.length > 0 && (
        <Text as="p" size="sm" tone="muted">
          Not shown because {omitted.length === 1 ? 'it changes' : 'they change'} nothing structurally: {omitted.map((c) => c.title ?? c.name).join(', ')}.
        </Text>
      )}
      <div className={styles.toggle} role="group" aria-label="Show this as">
        <Button variant={view === 'list' ? 'primary' : 'secondary'} type="button" aria-pressed={view === 'list'} onClick={() => { setView('list'); }}>
          List
        </Button>
        <Button variant={view === 'diagram' ? 'primary' : 'secondary'} type="button" aria-pressed={view === 'diagram'} onClick={() => { setView('diagram'); }}>
          Diagram
        </Button>
      </div>
      {data.map((capability) => (
        <section key={capability.id} className={styles.capability} aria-label={capability.name}>
          <Text as="h3" size="md">
            <Link to={`${base}/e/${capability.id}`}>{capability.name}</Link>
          </Text>
          {view === 'list' ? (
            <div className={styles.columns}>
              <Column column={capability.today} base={base} scopeSystemIds={scopeSystemIds} />
              {capability.after.map((column) => (
                <Column key={column.changeId} column={column} base={base} scopeSystemIds={scopeSystemIds} />
              ))}
            </div>
          ) : (
            <div className={styles.diagrams}>
              <ProjectDiagram capability={capability} column={capability.today} scopeSystemIds={scopeSystemIds} base={base} />
              {capability.after.map((column) => (
                <ProjectDiagram key={column.changeId} capability={capability} column={column} scopeSystemIds={scopeSystemIds} base={base} />
              ))}
            </div>
          )}
          {capability.after.length === 0 && (
            <Text as="p" size="sm" tone="muted">
              No change has been drafted yet, so there is no “after” to compare.
            </Text>
          )}
        </section>
      ))}
    </>
  );
  if (embedded) return <div data-testid="project-before-after">{content}</div>;
  return <Panel data-testid="project-before-after"><ProjectStep stepKey="before-after" projectId={projectId} title="What this changes, capability by capability" summary={`${String(data.length)} ${data.length === 1 ? 'capability' : 'capabilities'}`} defaultOpen>{content}</ProjectStep></Panel>;
}
