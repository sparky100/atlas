import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { listProjectsForModel } from '../../db/projects';
import type { ProjectRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import styles from './ProjectAssignment.module.css';

export interface ProjectAssignmentProps {
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
  currentProjectId: UUID | null;
  /** Offer the move control at all — the caller's role/status check (the database is the real gate). */
  canMove: boolean;
  /** Shown instead of the control when moving isn't possible here, e.g. "Moves with its decision." */
  lockedReason?: string | null;
  /** Performs the move; reject to show the refusal. */
  onMove: (projectId: UUID | null) => Promise<void>;
}

/**
 * F10 step 4 (ADR-024 §6.4): "Project: …" on a change or decision page,
 * with "Add to project…" / "Move…" for those allowed. Only open projects
 * are offered — a closed or cancelled project accepts nothing new.
 */
export function ProjectAssignment({ modelId, orgSlug, modelSlug, currentProjectId, canMove, lockedReason = null, onMove }: ProjectAssignmentProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<string>(currentProjectId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjectsForModel(supabase, modelId).then(
      (rows) => {
        if (!cancelled) setProjects(rows);
      },
      (e: unknown) => {
        reportError("Couldn't load this model's projects.", e);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const current = projects.find((p) => p.id === currentProjectId) ?? null;
  const openProjects = projects.filter((p) => p.status === 'active' || p.status === 'on_hold');

  return (
    <div className={styles.assignment}>
      <Text as="span" size="sm" tone="muted">
        Project:
      </Text>{' '}
      {current ? <Link to={`/o/${orgSlug}/m/${modelSlug}/projects/${current.id}`}>{current.title}</Link> : <Text as="span" size="sm">None</Text>}
      {canMove && lockedReason === null && !picking && openProjects.length > 0 && (
        <Button
          variant="ghost"
          onClick={() => {
            setChoice(currentProjectId ?? '');
            setPicking(true);
          }}
        >
          {currentProjectId === null ? 'Add to project…' : 'Move…'}
        </Button>
      )}
      {canMove && lockedReason !== null && (
        <Text as="span" size="xs" tone="faint">
          {lockedReason}
        </Text>
      )}
      {picking && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            onMove(choice === '' ? null : choice)
              .then(() => {
                setPicking(false);
              })
              .catch((err: unknown) => {
                setError(err instanceof Error && /option|frozen|no longer|submitted/.test(err.message) ? plainRefusal(err.message) : 'Could not move this to that project.');
                reportError('Could not move this to that project.', err);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          <select
            aria-label="Project"
            className={styles.select}
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
            }}
          >
            <option value="">No project</option>
            {openProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <Button variant="primary" type="submit" disabled={busy || choice === (currentProjectId ?? '')}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button
            onClick={() => {
              setPicking(false);
            }}
          >
            Cancel
          </Button>
        </form>
      )}
      {error !== null && <Text as="p">{error}</Text>}
    </div>
  );
}

/** The database's own refusals (P1/P2), reworded without the function-name prefix. */
function plainRefusal(message: string): string {
  if (message.includes('move the decision instead')) return 'This change is an option of a decision — move the decision instead, and its options follow.';
  if (message.includes('already submitted or merged')) return 'An option of this decision is already submitted or merged in its current project, so the decision cannot move.';
  if (message.includes('can no longer change')) return 'This change is closed, so its project can no longer change.';
  return 'Could not move this to that project.';
}
