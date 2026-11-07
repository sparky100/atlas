/**
 * ADR-027 (F14 step 5): the saved-reports library on the Reports hub — the
 * model's saved reports (own private ones and the organisation's) with
 * open, rename, duplicate and delete, plus the saved copies taken. Who may
 * edit or delete is enforced by RLS; the buttons here just mirror it so
 * nobody is offered something the database would refuse.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { parseReportSpec } from '../../contracts/reportSpec';
import { createSavedReport, deleteSavedReport, listSavedReports, listSnapshotsForModel, updateSavedReport } from '../../db/reports';
import type { MemberRole, ReportSnapshotRow, SavedReportRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canCreateChangeBranch } from '../orgs/roleGates';
import { supabase } from '../supabaseClient';
import { copyLabel } from './copyLabel';
import { canEditReport } from './reportAccess';
import styles from './SavedReportsLibrary.module.css';

export interface SavedReportsLibraryProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  role: MemberRole | null;
  basePath: string;
}

const canEdit = canEditReport;

export function SavedReportsLibrary({ modelId, orgId, userId, role, basePath }: SavedReportsLibraryProps) {
  const [reports, setReports] = useState<SavedReportRow[]>([]);
  const [copies, setCopies] = useState<ReportSnapshotRow[]>([]);
  const [reload, setReload] = useState(0);
  const [renaming, setRenaming] = useState<{ id: UUID; name: string } | null>(null);
  const [deleting, setDeleting] = useState<UUID | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSavedReports(supabase, modelId), listSnapshotsForModel(supabase, modelId)])
      .then(([r, c]) => {
        if (cancelled) return;
        setReports(r);
        setCopies(c);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load saved reports.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reload]);

  async function attempt(action: () => Promise<void>, failure: string): Promise<void> {
    setMessage(null);
    try {
      await action();
      setReload((n) => n + 1);
    } catch (e: unknown) {
      reportError(failure, e);
      setMessage(e instanceof Error ? e.message : failure);
    }
  }

  const canCreate = userId !== null && canCreateChangeBranch(role);
  if (reports.length === 0 && copies.length === 0) {
    return (
      <section className={styles.section}>
        <Text as="h2" size="lg">
          Saved reports
        </Text>
        <Text as="p" tone="muted">
          Nothing saved yet. Filter the Elements or Portfolio page, then choose "Save as report…".
        </Text>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <Text as="h2" size="lg">
        Saved reports
      </Text>
      {message !== null && (
        <Text as="p" size="sm">
          {message}
        </Text>
      )}
      <ul className={styles.list}>
        {reports.map((r) => {
          const parsed = parseReportSpec(r.spec);
          return (
            <li key={r.id} className={styles.item}>
              {renaming?.id === r.id ? (
                <form
                  className={styles.row}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renaming.name.trim();
                    if (name === '') return;
                    void attempt(async () => {
                      await updateSavedReport(supabase, r.id, { name });
                      setRenaming(null);
                    }, "Couldn't rename the report.");
                  }}
                >
                  <input
                    className={styles.input}
                    aria-label="Report name"
                    value={renaming.name}
                    maxLength={120}
                    onChange={(e) => {
                      setRenaming({ id: r.id, name: e.target.value });
                    }}
                  />
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRenaming(null);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className={styles.row}>
                  <Link to={`${basePath}/reports/saved/${r.id}`}>{r.name}</Link>
                  <Text size="sm" tone="muted">
                    {parsed.ok ? parsed.spec.source : 'unreadable'} · {r.visibility === 'organisation' ? 'shared' : 'private'}
                  </Text>
                  {canEdit(r, userId, role) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRenaming({ id: r.id, name: r.name });
                      }}
                    >
                      Rename
                    </Button>
                  )}
                  {canCreate && parsed.ok && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void attempt(async () => {
                          await createSavedReport(supabase, { id: crypto.randomUUID(), orgId, modelId, name: `${r.name} (copy)`, description: r.description, spec: parsed.spec, createdBy: userId });
                        }, "Couldn't duplicate the report.");
                      }}
                    >
                      Duplicate
                    </Button>
                  )}
                  {canEdit(r, userId, role) && deleting !== r.id && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setDeleting(r.id);
                      }}
                    >
                      Delete…
                    </Button>
                  )}
                  {deleting === r.id && (
                    <>
                      <Text size="sm">Delete this report? Its saved copies are kept.</Text>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          void attempt(async () => {
                            await deleteSavedReport(supabase, r.id);
                            setDeleting(null);
                          }, "Couldn't delete the report.");
                        }}
                      >
                        Yes, delete it
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDeleting(null);
                        }}
                      >
                        Keep it
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {copies.length > 0 && (
        <>
          <Text as="h2" size="lg">
            Saved copies
          </Text>
          <ul className={styles.list}>
            {copies.map((c) => (
              <li key={c.id} className={styles.item}>
                <Link to={`${basePath}/reports/copies/${c.id}`}>{c.name}</Link>{' '}
                <Text size="sm" tone="muted">
                  {copyLabel(c.generated_at, c.commit_id)} · {c.row_count} {c.row_count === 1 ? 'row' : 'rows'}
                </Text>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
