/**
 * F2-lite ("spreadsheet import as reconciliation") — the import dialog:
 * file drop, template download, detected-columns/first-rows preview, and a
 * per-row reconciliation review (unchanged/changed/new/not-in-file/failed,
 * with a same-as/new picker for every row that needs one) before
 * committing. Opened from two entry points — the browse table's toolbar
 * (`ElementBrowseTable.tsx`) and the landscape's "+ Add" menu/empty state
 * (`LandscapePage.tsx`) — replacing F2 Phase 1/2's own `ChangesView.tsx`-
 * embedded panel: importing isn't a "changes" action so much as a
 * "systems/landscape" one, the same placement feedback this session's own
 * plan already settled.
 *
 * The product has no existing modal anywhere else (every other flow is an
 * inline page panel) — this is a deliberate first one, not a pattern this
 * component invents casually: the whole point of the two new entry points
 * is reaching this from wherever you're already looking at the model
 * (browse table, landscape) without navigating away first, which an inline
 * panel on a third, unrelated page could never do.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { IMPORT_COLUMNS } from '../../capture/importRowSchema';
import { importTemplateCsv } from '../../capture/importTemplate';
import type { MatchResolution } from '../../capture/buildImportCommit';
import { useSelectedRef } from '../branches/useSelectedRef';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { importTemplateXlsxBlob } from './importTemplateXlsx';
import { downloadImportPrompt } from './downloadImportPrompt';
import { useSpreadsheetImport } from '../changes/useSpreadsheetImport';
import { supabase } from '../supabaseClient';
import styles from './SpreadsheetImportDialog.module.css';

export interface SpreadsheetImportDialogProps {
  open: boolean;
  onClose: () => void;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadTemplateCsv(): void {
  downloadBlob(new Blob([importTemplateCsv()], { type: 'text/csv' }), 'import-template.csv');
}

function downloadTemplateXlsx(): void {
  downloadBlob(importTemplateXlsxBlob(), 'import-template.xlsx');
}

export function SpreadsheetImportDialog({ open, onClose, modelId, orgId, userId, orgSlug, modelSlug }: SpreadsheetImportDialogProps) {
  const navigate = useNavigate();
  const { setRef } = useSelectedRef();
  const { status, error, review, buildResult, notInFile, loadFile, resolveMatch, commit, reset } = useSpreadsheetImport(modelId, orgId, userId);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!open) return null;

  const rows = buildResult?.rows ?? [];
  const needsPickCount = rows.filter((r) => r.outcome.status === 'needs-pick').length;
  const blockedCount = rows.filter((r) => r.outcome.status === 'blocked').length;
  const newCount = rows.filter((r) => r.outcome.status === 'new').length;
  const changedCount = rows.filter((r) => r.outcome.status === 'changed').length;
  const unchangedCount = rows.filter((r) => r.outcome.status === 'unchanged').length;
  const relationshipRows = buildResult?.relationshipRows ?? [];
  const relationshipBlockedCount = relationshipRows.filter((r) => r.outcome.status === 'blocked').length;
  const changeRows = buildResult?.changeRows ?? [];
  const changeBlockedCount = changeRows.filter((r) => r.outcome.status === 'blocked').length;
  const canImport = rows.length > 0 && needsPickCount === 0 && blockedCount === 0 && relationshipBlockedCount === 0 && changeBlockedCount === 0;
  const totalBlockedCount = blockedCount + relationshipBlockedCount + changeBlockedCount;

  return (
    // Click-outside-to-close on the backdrop — mouse-only by design; Escape
    // (the `keydown` listener above) is the keyboard equivalent, and
    // `role="presentation"` tells assistive tech there's no content here to
    // reach.
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Import model updates" ref={panelRef}>
        <Panel raised className={styles.panel ?? ''}>
          <div className={styles.header}>
            <Text as="h2" size="lg">
              Import model updates
            </Text>
            <Button variant="ghost" aria-label="Close" onClick={handleClose}>
              ✕
            </Button>
          </div>

          <Text as="p" tone="muted" size="sm">
            One row per system, or a module (set <Text as="span" mono size="sm">platform</Text>). Columns: {IMPORT_COLUMNS.join(', ')} — only <Text as="span" mono size="sm">name</Text> is required. An XLSX file may also carry a "Relationships" sheet for <Text as="span" mono size="sm">uses</Text>/<Text as="span" mono size="sm">flows_to</Text> edges. A <Text as="span" mono size="sm">.json</Text> file uses the same reconciliation instead of sheets: <Text as="span" mono size="sm">{'{ systems, relationships, changes }'}</Text>, with <Text as="span" mono size="sm">changes</Text> an explicit retire/restore list for elements this file's own author already knows are being decommissioned or reinstated.
          </Text>
          <div className={styles.templateLinks}>
            <Button variant="ghost" onClick={downloadTemplateCsv}>
              Download template (CSV)
            </Button>
            <Button variant="ghost" onClick={downloadTemplateXlsx}>
              Download template (XLSX)
            </Button>
            <Button variant="ghost" onClick={() => void downloadImportPrompt(supabase, modelId, modelSlug)}>
              Download AI import prompt
            </Button>
          </div>

          {(status === 'idle' || status === 'loading' || status === 'error') && (
            <div className={styles.dropzone}>
              <input
                type="file"
                accept=".csv,.xlsx,.json"
                aria-label="Choose a CSV, XLSX, or JSON file to import"
                disabled={status === 'loading'}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
              {status === 'loading' && (
                <Text tone="muted" size="sm">
                  Reading…
                </Text>
              )}
            </div>
          )}

          {error !== null && (
            <Text as="p" size="sm">
              {error}
            </Text>
          )}

          {review && (status === 'review' || status === 'committing') && (
            <div className={styles.review}>
              <CollapsibleSection title="Detected columns" defaultOpen={false}>
                <Text as="p" size="sm" mono>
                  {review.detectedColumns.join(', ')}
                </Text>
              </CollapsibleSection>

              <CollapsibleSection title="Systems" meta={`(${String(rows.length)})`}>
                <div className={styles.preview}>
                  <div className={styles.counts}>
                    <Chip tone="info">{newCount} new</Chip>
                    <Chip tone="info">{changedCount} changed</Chip>
                    <Chip tone="neutral">{unchangedCount} unchanged</Chip>
                    {needsPickCount > 0 && <Chip tone="warn">{needsPickCount} need a pick</Chip>}
                    {blockedCount > 0 && <Chip tone="danger">{blockedCount} failed</Chip>}
                    {review.parseErrors.length > 0 && <Chip tone="danger">{review.parseErrors.length} invalid</Chip>}
                  </div>

                  {review.parseErrors.length > 0 && (
                    <ul className={styles.rowList}>
                      {review.parseErrors.map((e) => (
                        <li key={e.rowNumber}>
                          <Text as="p" size="sm">
                            Row {e.rowNumber}: {e.error}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  )}

                  <ul className={styles.rowList}>
                    {rows
                      .filter((r) => r.outcome.status !== 'unchanged')
                      .map((r) => (
                        <li key={r.rowNumber} className={styles.row}>
                          <div className={styles.rowMain}>
                            <Text as="span">{r.name}</Text>
                            {r.outcome.status === 'new' && <Chip tone="info">New</Chip>}
                            {r.outcome.status === 'changed' && <Chip tone="info">Changed: {r.outcome.changedColumns.join(', ')}</Chip>}
                            {r.outcome.status === 'blocked' && <Chip tone="danger">{r.outcome.reason}</Chip>}
                          </div>
                          {r.outcome.status === 'needs-pick' && (
                            <select
                              className={styles.select}
                              aria-label={`Which existing element does row ${String(r.rowNumber)} match?`}
                              defaultValue=""
                              onChange={(e) => {
                                const choice: MatchResolution = e.target.value === 'new' ? 'new' : e.target.value;
                                resolveMatch(r.rowNumber, choice);
                              }}
                            >
                              <option value="" disabled>
                                {r.outcome.candidates.length} near-match(es) — pick one
                              </option>
                              {r.outcome.candidates.map((c) => (
                                <option key={c.elementId} value={c.elementId}>
                                  Same as: {c.name}
                                </option>
                              ))}
                              <option value="new">Create new instead</option>
                            </select>
                          )}
                          {r.warnings.map((w) => (
                            <Text as="p" size="sm" tone="muted" key={w}>
                              {w}
                            </Text>
                          ))}
                        </li>
                      ))}
                  </ul>
                </div>
              </CollapsibleSection>

              {relationshipRows.length > 0 && (
                <CollapsibleSection title="Relationships" meta={`(${String(relationshipRows.length)})`}>
                  <div className={styles.preview}>
                    <div className={styles.counts}>
                      <Chip tone="info">{relationshipRows.filter((r) => r.outcome.status === 'new').length} new</Chip>
                      <Chip tone="info">{relationshipRows.filter((r) => r.outcome.status === 'changed').length} changed</Chip>
                      <Chip tone="neutral">{relationshipRows.filter((r) => r.outcome.status === 'unchanged').length} unchanged</Chip>
                      {relationshipBlockedCount > 0 && <Chip tone="danger">{relationshipBlockedCount} failed</Chip>}
                    </div>
                    {review.relationshipParseErrors.length > 0 && (
                      <ul className={styles.rowList}>
                        {review.relationshipParseErrors.map((e) => (
                          <li key={e.rowNumber}>
                            <Text as="p" size="sm">
                              Relationships row {e.rowNumber}: {e.error}
                            </Text>
                          </li>
                        ))}
                      </ul>
                    )}
                    {relationshipBlockedCount > 0 && (
                      <ul className={styles.rowList}>
                        {relationshipRows
                          .filter((r) => r.outcome.status === 'blocked')
                          .map((r) => (
                            <li key={r.rowNumber} className={styles.row}>
                              <Text as="span" size="sm">
                                Row {r.rowNumber}
                              </Text>
                              {r.outcome.status === 'blocked' && <Chip tone="danger">{r.outcome.reason}</Chip>}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                </CollapsibleSection>
              )}

              {changeRows.length > 0 && (
                <CollapsibleSection title="Changes" meta={`(${String(changeRows.length)})`}>
                  <div className={styles.preview}>
                    <div className={styles.counts}>
                      <Chip tone="info">{changeRows.filter((r) => r.outcome.status === 'applied').length} to apply</Chip>
                      <Chip tone="neutral">{changeRows.filter((r) => r.outcome.status === 'unchanged').length} unchanged</Chip>
                      {changeBlockedCount > 0 && <Chip tone="danger">{changeBlockedCount} failed</Chip>}
                    </div>
                    {review.changeParseErrors.length > 0 && (
                      <ul className={styles.rowList}>
                        {review.changeParseErrors.map((e) => (
                          <li key={e.rowNumber}>
                            <Text as="p" size="sm">
                              Changes entry {e.rowNumber}: {e.error}
                            </Text>
                          </li>
                        ))}
                      </ul>
                    )}
                    <ul className={styles.rowList}>
                      {changeRows
                        .filter((r) => r.outcome.status !== 'unchanged')
                        .map((r) => (
                          <li key={r.rowNumber} className={styles.row}>
                            <div className={styles.rowMain}>
                              <Text as="span">{r.name}</Text>
                              <Chip tone={r.outcome.status === 'blocked' ? 'danger' : 'info'}>{r.outcome.status === 'blocked' ? r.outcome.reason : r.action === 'retire' ? 'Retire' : 'Restore'}</Chip>
                            </div>
                            {r.reason !== null && (
                              <Text as="p" size="sm" tone="muted">
                                {r.reason}
                              </Text>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                </CollapsibleSection>
              )}

              {notInFile.length > 0 && (
                <CollapsibleSection title="Not in file" meta={`(${String(notInFile.length)})`} defaultOpen={false}>
                  <div className={styles.notInFile}>
                    <Text as="p" size="sm" tone="muted">
                      Still in the model, but this file never mentioned them — nothing is retracted; retire one from the change page after importing.
                    </Text>
                    <ul className={styles.rowList}>
                      {notInFile.map((n) => (
                        <li key={n.elementId}>
                          <Text as="span" size="sm">
                            {n.name}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CollapsibleSection>
              )}

              <div className={styles.actions}>
                <Button
                  variant="primary"
                  disabled={status !== 'review' || !canImport}
                  onClick={() => {
                    void commit().then((branchId) => {
                      if (!branchId) return;
                      setRef({ kind: 'branch', branchId });
                      handleClose();
                      void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
                    });
                  }}
                >
                  {status === 'committing' ? 'Importing…' : needsPickCount > 0 ? `Resolve ${String(needsPickCount)} row(s) first` : totalBlockedCount > 0 ? `${String(totalBlockedCount)} row(s) failed` : 'Import'}
                </Button>
                <Button variant="ghost" disabled={status === 'committing'} onClick={reset}>
                  Choose a different file
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
