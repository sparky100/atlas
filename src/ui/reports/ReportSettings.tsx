/**
 * ADR-027 (F14 follow-up): edit a saved report from its own page — how it is
 * shown (table, count, bar, donut), what it groups and splits by, how many
 * rows a table shows, its description, and whether it is shared with the
 * organisation. Without this, the bar, stacked-bar and donut charts (and
 * their dashboard tiles) could never be reached: "Save as report" from a page
 * always stores a flat table.
 */
import { useState } from 'react';
import type { ReportSpec } from '../../contracts/reportSpec';
import { updateSavedReport } from '../../db/reports';
import type { ReportVisibility, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { applyShape, groupableFields, REPORT_SHOW_AS_LABEL, shapeOfSpec, type ReportShowAs } from './reportShape';
import { reportFieldLabel } from './reportTable';
import styles from './ReportSettings.module.css';

export interface ReportSettingsProps {
  report: SavedReportRow;
  spec: ReportSpec;
  knownFields: readonly string[];
  canShare: boolean;
  onSaved: (report: SavedReportRow) => void;
}

const SHOW_AS: readonly ReportShowAs[] = ['table', 'count', 'bar', 'donut'];

export function ReportSettings({ report, spec, knownFields, canShare, onSaved }: ReportSettingsProps) {
  const initial = shapeOfSpec(spec);
  const [open, setOpen] = useState(false);
  const [showAs, setShowAs] = useState<ReportShowAs>(initial.showAs);
  const [groupBy, setGroupBy] = useState(initial.groupBy ?? '');
  const [splitBy, setSplitBy] = useState(initial.splitBy ?? '');
  const [limit, setLimit] = useState(initial.limit === null ? '' : String(initial.limit));
  const [description, setDescription] = useState(report.description);
  const [visibility, setVisibility] = useState<ReportVisibility>(report.visibility);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fields = groupableFields(spec.source, knownFields);
  // A field the report already uses stays offered even if the source no longer lists it, so opening the editor never silently changes the report.
  const options = [...fields, ...[initial.groupBy, initial.splitBy].filter((f): f is string => f !== null && !fields.includes(f))];

  function reset(): void {
    setShowAs(initial.showAs);
    setGroupBy(initial.groupBy ?? '');
    setSplitBy(initial.splitBy ?? '');
    setLimit(initial.limit === null ? '' : String(initial.limit));
    setDescription(report.description);
    setVisibility(report.visibility);
    setMessage(null);
  }

  async function save(): Promise<void> {
    const trimmed = limit.trim();
    const shaped = applyShape(spec, {
      showAs,
      groupBy: groupBy === '' ? null : groupBy,
      splitBy: splitBy === '' ? null : splitBy,
      limit: showAs === 'table' && trimmed !== '' ? Number(trimmed) : null,
    });
    if (!shaped.ok) {
      setMessage(shaped.reason);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const nextVisibility = canShare ? visibility : report.visibility;
      await updateSavedReport(supabase, report.id, { spec: shaped.spec, description: description.trim(), visibility: nextVisibility });
      setOpen(false);
      onSaved({ ...report, spec: shaped.spec as unknown as SavedReportRow['spec'], spec_version: shaped.spec.specVersion, description: description.trim(), visibility: nextVisibility });
    } catch (e: unknown) {
      reportError("Couldn't save the report's settings.", e);
      setMessage(e instanceof Error ? e.message : "Couldn't save the report's settings.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          Edit report settings…
        </Button>
      </div>
    );
  }

  const grouped = showAs !== 'count';
  return (
    <form
      className={styles.panel}
      aria-label="Report settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text as="h2" size="lg">
        Report settings
      </Text>
      <Text as="p" size="sm" tone="muted">
        To change which rows the report includes, open it from the {spec.source === 'portfolio' ? 'Portfolio' : 'Elements'} page, adjust the filters, and choose "Save changes". These settings are kept when you do.
      </Text>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Show as</span>
          <select
            className={styles.select}
            value={showAs}
            onChange={(e) => {
              setShowAs(e.target.value as ReportShowAs);
            }}
          >
            {SHOW_AS.map((k) => (
              <option key={k} value={k}>
                {REPORT_SHOW_AS_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {grouped && (
          <label className={styles.field}>
            <span>Group by</span>
            <select
              className={styles.select}
              value={groupBy}
              onChange={(e) => {
                setGroupBy(e.target.value);
                if (e.target.value === '') setSplitBy('');
              }}
            >
              <option value="">{showAs === 'table' ? 'No grouping' : 'Choose a field…'}</option>
              {options.map((f) => (
                <option key={f} value={f}>
                  {reportFieldLabel(f)}
                </option>
              ))}
            </select>
          </label>
        )}
        {grouped && showAs !== 'donut' && groupBy !== '' && (
          <label className={styles.field}>
            <span>Split by</span>
            <select
              className={styles.select}
              value={splitBy}
              onChange={(e) => {
                setSplitBy(e.target.value);
              }}
            >
              <option value="">No split</option>
              {options
                .filter((f) => f !== groupBy)
                .map((f) => (
                  <option key={f} value={f}>
                    {reportFieldLabel(f)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {showAs === 'table' && (
          <label className={styles.field}>
            <span>Rows to show</span>
            <input
              className={styles.input}
              inputMode="numeric"
              placeholder="All"
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value);
              }}
            />
          </label>
        )}
      </div>
      <label className={styles.field}>
        <span>Description</span>
        <textarea
          className={styles.textarea}
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
      </label>
      {canShare && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={visibility === 'organisation'}
            onChange={(e) => {
              setVisibility(e.target.checked ? 'organisation' : 'private');
            }}
          />
          <span>Share with the organisation</span>
        </label>
      )}
      <Text as="p" size="sm" tone="muted">
        A grouped report can be added to a dashboard as a bar chart or donut; grouped and split, as a stacked bar.
      </Text>
      <div className={styles.row}>
        <Button variant="primary" type="submit" disabled={busy}>
          Save settings
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
