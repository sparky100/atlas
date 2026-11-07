/**
 * ADR-027 (F14 follow-up): "Add standard dashboards…" on the Reports hub.
 * Lists the standard dashboards (`standardDashboards.ts`), and for the ones
 * picked creates their saved reports, the dashboard and its tiles — all
 * ordinary, editable items owned by the person who added them. Shared with
 * the organisation when an owner or architect adds them, else private.
 */
import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { addDashboardTile, createDashboard, createSavedReport } from '../../db/reports';
import type { DashboardRow, MemberRole } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { canShareReport } from './reportAccess';
import { STANDARD_DASHBOARDS, type StandardDashboard } from './standardDashboards';
import styles from './StandardDashboardsOffer.module.css';

export interface StandardDashboardsOfferProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  role: MemberRole | null;
  existing: readonly DashboardRow[];
  onAdded: (firstDashboardId: UUID) => void;
}

async function install(d: StandardDashboard, ids: { orgId: UUID; modelId: UUID; userId: UUID }, visibility: 'private' | 'organisation'): Promise<UUID> {
  const dashboardId = crypto.randomUUID();
  // Reports first: a tile needs its report to exist, and a shared dashboard may only show shared reports.
  const reportIds: UUID[] = [];
  for (const t of d.tiles) {
    const created = await createSavedReport(supabase, { id: crypto.randomUUID(), orgId: ids.orgId, modelId: ids.modelId, name: t.name, description: t.description, spec: t.spec, visibility, createdBy: ids.userId });
    reportIds.push(created.id);
  }
  await createDashboard(supabase, { id: dashboardId, orgId: ids.orgId, modelId: ids.modelId, name: d.name, visibility, createdBy: ids.userId });
  for (const [position, t] of d.tiles.entries()) {
    const reportId = reportIds[position];
    if (reportId === undefined) continue;
    await addDashboardTile(supabase, { id: crypto.randomUUID(), dashboardId, reportId, position, kind: t.kind, size: t.size, rowLimit: t.rowLimit ?? null });
  }
  return dashboardId;
}

export function StandardDashboardsOffer({ modelId, orgId, userId, role, existing, onAdded }: StandardDashboardsOfferProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const shared = canShareReport(role);
  const taken = new Set(existing.map((d) => d.name));

  if (!open) {
    return (
      <div>
        <Button
          onClick={() => {
            setOpen(true);
            setPicked(new Set(STANDARD_DASHBOARDS.filter((d) => !taken.has(d.name)).map((d) => d.key)));
            setMessage(null);
          }}
        >
          Add standard dashboards…
        </Button>
      </div>
    );
  }

  async function add(): Promise<void> {
    setBusy(true);
    setMessage(null);
    let first: UUID | null = null;
    try {
      for (const d of STANDARD_DASHBOARDS) {
        if (!picked.has(d.key)) continue;
        const id = await install(d, { orgId, modelId, userId }, shared ? 'organisation' : 'private');
        first ??= id;
      }
      if (first !== null) onAdded(first);
    } catch (e: unknown) {
      reportError("Couldn't add the standard dashboards.", e);
      setMessage(`${e instanceof Error ? e.message : "Couldn't add the standard dashboards."} Anything already added is listed under Saved reports and Dashboards, and can be deleted there.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.panel}
      aria-label="Add standard dashboards"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Text as="h3" size="md">
        Standard dashboards
      </Text>
      <Text as="p" size="sm" tone="muted">
        Each adds a dashboard and its saved reports to this model, {shared ? 'shared with the organisation' : 'private to you'}. They are ordinary reports: change, rename or delete them as you like.
      </Text>
      <ul className={styles.list}>
        {STANDARD_DASHBOARDS.map((d) => {
          const already = taken.has(d.name);
          return (
            <li key={d.key}>
              <label className={styles.option} aria-label={already ? `${d.name} (already added)` : d.name}>
                <input
                  type="checkbox"
                  disabled={already}
                  checked={picked.has(d.key)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(d.key);
                    else next.delete(d.key);
                    setPicked(next);
                  }}
                />
                <span className={styles.text}>
                  <span className={styles.name}>
                    {d.name}
                    {already ? ' (already added)' : ''}
                  </span>
                  <Text size="sm" tone="muted">
                    {d.summary} {d.tiles.length} tiles.
                  </Text>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy || picked.size === 0}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {message !== null && (
        <Text as="p" size="sm">
          {message}
        </Text>
      )}
    </form>
  );
}
