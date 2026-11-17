import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { GoalCapabilityRow, GoalRow } from '../../contracts/goals';
import { linkCapabilityToGoal, listGoalLinksForGoals, listGoalsForModel, unlinkCapabilityFromGoal } from '../../db/goals';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { goalsForCapability } from './goalModel';
import styles from './GoalsView.module.css';

export interface CapabilityGoalsSectionProps {
  modelId: UUID;
  capabilityId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** Owner or architect (`canEditGoals`). The picker and Remove buttons are omitted, not disabled, when false. */
  canEdit: boolean;
}

/** ADR-035: "Why it matters" on a capability: the goals it serves, as links to the Goals page. */
export function CapabilityGoalsSection({ modelId, capabilityId, userId, orgSlug, modelSlug, canEdit }: CapabilityGoalsSectionProps) {
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [links, setLinks] = useState<GoalCapabilityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listGoalsForModel(supabase, modelId)
      .then(async (rows) => {
        const linkRows = await listGoalLinksForGoals(supabase, rows.map((g) => g.id));
        if (cancelled) return;
        setGoals(rows);
        setLinks(linkRows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setGoals([]);
        setError("Couldn't load the goals.");
        reportError("Couldn't load the goals.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const change = useCallback(async (failure: string, work: () => Promise<void>) => {
    setError(null);
    setSaving(true);
    try {
      await work();
      setReloadToken((t) => t + 1);
    } catch (e) {
      setError(failure);
      reportError(failure, e);
    }
    setSaving(false);
  }, []);

  if (goals === null) return <Text as="p" tone="muted" size="sm">Loading…</Text>;

  const serving = goalsForCapability(capabilityId, goals, links);
  const servingIds = new Set(serving.map((g) => g.id));
  const options = goals.filter((g) => g.status === 'active' && !servingIds.has(g.id)).sort((a, b) => a.title.localeCompare(b.title));
  const goalsHref = `/o/${orgSlug}/m/${modelSlug}/goals`;

  return (
    <div>
      {serving.length === 0 ? (
        <Text as="p" tone="muted" size="sm">
          No goal linked yet.
        </Text>
      ) : (
        <ul className={styles.uses} aria-label="Goals this capability serves">
          {serving.map((g) => (
            <li key={g.id}>
              <span className={styles.capRow}>
                <Link to={goalsHref}>{g.title}</Link>
                {canEdit && (
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      void change('Could not remove that link.', () => unlinkCapabilityFromGoal(supabase, g.id, capabilityId));
                    }}
                    aria-label={`Stop linking this capability to ${g.title}`}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && options.length > 0 && userId !== null && (
        <div className={styles.picker}>
          <label htmlFor="capability-goal-pick">
            <Text as="span" size="sm" tone="muted">
              Link a goal
            </Text>
          </label>
          <select id="capability-goal-pick" className={styles.select} value={pick} onChange={(e) => { setPick(e.target.value); }}>
            <option value="">Choose…</option>
            {options.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            type="button"
            disabled={saving || pick === ''}
            onClick={() => {
              const goalId = pick;
              setPick('');
              void change('Could not link that goal.', async () => {
                await linkCapabilityToGoal(supabase, { goalId, capabilityId, createdBy: userId });
              });
            }}
          >
            Add goal
          </Button>
        </div>
      )}
      {error !== null && <Text as="p" size="sm">{error}</Text>}
    </div>
  );
}
