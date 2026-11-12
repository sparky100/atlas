import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { createSavedReport } from '../../db/reports';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { STARTER_REPORTS } from './relationshipAndFindingReports';
import styles from './ReportSettings.module.css';

interface NewModelReportProps {
  orgId: UUID;
  modelId: UUID;
  userId: UUID;
  basePath: string;
}

export function NewModelReport({ orgId, modelId, userId, basePath }: NewModelReportProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const template = STARTER_REPORTS.find((report) => report.name === selection);

  async function save() {
    if (!template || busy || name.trim() === '') return;
    setBusy(true);
    setFailed(false);
    try {
      const created = await createSavedReport(supabase, {
        id: crypto.randomUUID(), orgId, modelId, createdBy: userId,
        name: name.trim(), spec: template.spec, visibility: 'private',
      });
      void navigate(`${basePath}/reports/saved/${created.id}`);
    } catch (error: unknown) {
      console.error("Couldn't create the report.", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button onClick={() => { setOpen(true); }}>New relationship or finding report…</Button>;
  return (
    <form aria-label="New model report" className={styles.panel} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Start with</span>
          <select className={styles.select} value={selection} disabled={busy} onChange={(event) => {
            setSelection(event.target.value);
            setName(event.target.value);
            setFailed(false);
          }}>
            <option value="">Choose a report</option>
            {STARTER_REPORTS.map((report) => <option key={report.name}>{report.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>Report name</span>
          <input className={styles.reportName} value={name} maxLength={120} required disabled={busy} onChange={(event) => { setName(event.target.value); }} />
        </label>
      </div>
      {failed && <div role="alert"><Text>Couldn’t create the report. Try again.</Text></div>}
      <div className={styles.row}>
        <Button type="submit" variant="primary" disabled={!template || name.trim() === '' || busy}>{busy ? 'Creating…' : 'Create report'}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); }}>Cancel</Button>
      </div>
    </form>
  );
}
