/** ADR-027 (F14 step 6b): the model's dashboards on the Reports hub, and a "New dashboard" form (contributors and above). */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { createDashboard, listDashboards } from '../../db/reports';
import type { DashboardRow, MemberRole } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canCreateChangeBranch } from '../orgs/roleGates';
import { supabase } from '../supabaseClient';
import styles from './SavedReportsLibrary.module.css';

export interface DashboardsListProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  basePath: string;
}

export function DashboardsList({ modelId, orgId, userId, role, basePath }: DashboardsListProps) {
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const canCreate = userId !== null && canCreateChangeBranch(role);

  useEffect(() => {
    let cancelled = false;
    listDashboards(supabase, modelId)
      .then((list) => {
        if (!cancelled) setDashboards(list);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load dashboards.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  if (dashboards.length === 0 && !canCreate) return null;

  return (
    <section className={styles.section}>
      <Text as="h2" size="lg">
        Dashboards
      </Text>
      {dashboards.length === 0 && (
        <Text as="p" tone="muted">
          No dashboards yet. A dashboard shows several saved reports together, live.
        </Text>
      )}
      <ul className={styles.list}>
        {dashboards.map((d) => (
          <li key={d.id} className={styles.item}>
            <Link to={`${basePath}/reports/dashboards/${d.id}`}>{d.name}</Link>{' '}
            <Text size="sm" tone="muted">
              {d.visibility === 'organisation' ? 'shared' : 'private'}
            </Text>
          </li>
        ))}
      </ul>
      {canCreate && !creating && (
        <div>
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            New dashboard…
          </Button>
        </div>
      )}
      {canCreate && creating && (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() === '') return;
            const id = crypto.randomUUID();
            createDashboard(supabase, { id, orgId, modelId, name: name.trim(), createdBy: userId })
              .then(() => navigate(`${basePath}/reports/dashboards/${id}`))
              .catch((err: unknown) => {
                reportError("Couldn't create the dashboard.", err);
                setMessage(err instanceof Error ? err.message : "Couldn't create the dashboard.");
              });
          }}
        >
          <input
            className={styles.input}
            aria-label="Dashboard name"
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <Button type="submit" variant="primary" disabled={name.trim() === ''}>
            Create
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false);
            }}
          >
            Cancel
          </Button>
          {message !== null && (
            <Text as="p" size="sm">
              {message}
            </Text>
          )}
        </form>
      )}
    </section>
  );
}
