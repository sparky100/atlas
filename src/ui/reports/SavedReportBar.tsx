/**
 * ADR-027 (F14 step 4): "Saved reports" strip for a page that can be saved
 * as a report (Elements, Portfolio). Lists the reports for this page's
 * source, opens one into the page's own controls, and saves the page's
 * current filters and sort as a new private report (or an organisation one,
 * for an owner or architect). It stores a question, never rows (rule 2).
 *
 * The page owns the mapping between its state and a spec
 * (`elementsReport.ts`, `portfolioReport.ts`); this component only moves
 * specs to and from the database.
 */
import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { parseReportSpec, type ReportSource, type ReportSpec } from '../../contracts/reportSpec';
import { createSavedReport, listSavedReports } from '../../db/reports';
import type { MemberRole, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canCreateChangeBranch } from '../orgs/roleGates';
import { supabase } from '../supabaseClient';
import styles from './SavedReportBar.module.css';

export type CurrentSpec = { ok: true; spec: ReportSpec } | { ok: false; reason: string };

export interface SavedReportBarProps {
  source: ReportSource;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  /** The page's current state as a report, or why it cannot be one. */
  current: CurrentSpec;
  /** Applies a saved spec to the page. Returns a plain reason if the page cannot show it, else `null`. */
  onOpen: (spec: ReportSpec) => string | null;
}

export function SavedReportBar({ source, modelId, orgId, userId, role, current, onOpen }: SavedReportBarProps) {
  const [reports, setReports] = useState<SavedReportRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const canSave = userId !== null && canCreateChangeBranch(role);
  const canShare = role === 'owner' || role === 'architect';

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    listSavedReports(supabase, modelId)
      .then((all) => {
        if (!cancelled) setReports(all);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load saved reports.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const ofThisPage = reports.filter((r) => {
    const parsed = parseReportSpec(r.spec);
    return !parsed.ok || parsed.spec.source === source;
  });

  function open(): void {
    const report = reports.find((r) => r.id === selectedId);
    if (!report) return;
    const parsed = parseReportSpec(report.spec);
    if (!parsed.ok) {
      setMessage(parsed.error);
      return;
    }
    setMessage(onOpen(parsed.spec));
  }

  async function save(): Promise<void> {
    if (!current.ok || userId === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const created = await createSavedReport(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        name: name.trim(),
        spec: current.spec,
        visibility: canShare && shared ? 'organisation' : 'private',
        createdBy: userId,
      });
      setSaving(false);
      setName('');
      setShared(false);
      setSelectedId(created.id);
      setMessage(`Saved “${created.name}”.`);
      setReloadToken((t) => t + 1);
    } catch (e: unknown) {
      reportError("Couldn't save the report.", e);
      setMessage(e instanceof Error ? e.message : "Couldn't save the report.");
    } finally {
      setBusy(false);
    }
  }

  if (!canSave && ofThisPage.length === 0) return null;

  return (
    <div className={styles.bar}>
      {ofThisPage.length > 0 && (
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Saved reports</span>
            <select
              className={styles.select}
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setMessage(null);
              }}
            >
              <option value="">Choose a report…</option>
              {ofThisPage.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.visibility === 'organisation' ? ' (shared)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={selectedId === ''} onClick={open}>
            Open
          </Button>
        </div>
      )}
      {canSave && !saving && (
        <Button
          variant="ghost"
          onClick={() => {
            setSaving(true);
            setMessage(null);
          }}
        >
          Save as report…
        </Button>
      )}
      {canSave && saving && (
        <form
          className={styles.row}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className={styles.field}>
            <span>Report name</span>
            <input
              className={styles.input}
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          {canShare && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => {
                  setShared(e.target.checked);
                }}
              />
              <span>Share with the organisation</span>
            </label>
          )}
          <Button variant="primary" type="submit" disabled={busy || name.trim() === '' || !current.ok}>
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSaving(false);
            }}
          >
            Cancel
          </Button>
          {!current.ok && (
            <Text as="p" size="sm" tone="muted">
              {current.reason}
            </Text>
          )}
        </form>
      )}
      {message !== null && (
        <Text as="p" size="sm" tone="muted">
          {message}
        </Text>
      )}
    </div>
  );
}
