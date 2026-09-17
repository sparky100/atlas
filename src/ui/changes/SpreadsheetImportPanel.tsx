import { useNavigate } from 'react-router';
import { useSelectedRef } from '../branches/useSelectedRef';
import { IMPORT_COLUMNS } from '../../capture/importRowSchema';
import type { MatchedImportRow } from '../../capture/matchImportRows';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useSpreadsheetImport } from './useSpreadsheetImport';
import styles from './SpreadsheetImportPanel.module.css';

export interface SpreadsheetImportPanelProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
}

/**
 * One row's own match summary — "New", "Matched: <name>", or a picker for
 * the rare exact-name tie (`matchImportRows.ts`'s own `ambiguous` outcome).
 *
 * `onPick`'s own `'new' | UUID` union looks redundant to the type checker
 * (`UUID` is a plain `string` alias, `contracts/delta.ts`) even though
 * `'new'` is a real, distinct sentinel at runtime, never an actual id —
 * same reasoning `buildImportCommit.ts`'s `MatchResolution` type suppresses
 * this exact rule for.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function MatchCell({ matched, onPick }: { matched: MatchedImportRow; onPick: (choice: 'new' | UUID) => void }) {
  if (matched.match.kind === 'new') return <Chip tone="info">New</Chip>;
  if (matched.match.kind === 'matched') return <Chip tone="ok">Matched: {matched.match.element.name}</Chip>;
  return (
    <select
      className={styles.select}
      aria-label={`Which existing system does row ${String(matched.row.rowNumber)} match?`}
      defaultValue=""
      onChange={(e) => {
        onPick(e.target.value === 'new' ? 'new' : e.target.value);
      }}
    >
      <option value="" disabled>
        {matched.match.candidates.length} matches — pick one
      </option>
      {matched.match.candidates.map((c) => (
        <option key={c.elementId} value={c.elementId}>
          {c.name}
        </option>
      ))}
      <option value="new">Create new instead</option>
    </select>
  );
}

/**
 * F2 (narrowed capture pipeline), Phase 1 — "Import a spreadsheet…" on the
 * Changes page. Pick a file → review every row's own match outcome →
 * resolve any exact-name tie → commit to a fresh `record`-intent change
 * branch, which the existing review/merge flow takes over from there
 * (this session's plan: no new review queue is built for this).
 */
export function SpreadsheetImportPanel({ modelId, orgId, userId, orgSlug, modelSlug }: SpreadsheetImportPanelProps) {
  const navigate = useNavigate();
  const { setRef } = useSelectedRef();
  const { status, error, review, resolutions, loadFile, resolveMatch, commit, reset } = useSpreadsheetImport(modelId, orgId, userId);

  const unresolvedCount = review ? review.matchedRows.filter((m) => m.match.kind === 'ambiguous' && !resolutions.has(m.row.rowNumber)).length : 0;

  return (
    <Panel>
      <Text as="h2" size="lg">
        Import a spreadsheet
      </Text>
      <Text as="p" tone="muted" size="sm">
        One row per system. Columns: {IMPORT_COLUMNS.join(', ')} — only <Text as="span" mono size="sm">name</Text> is required.
      </Text>

      {status === 'idle' || status === 'loading' ? (
        <div className={styles.dropzone}>
          <input
            type="file"
            accept=".csv,.xlsx"
            aria-label="Choose a CSV or XLSX file to import"
            disabled={status === 'loading'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
          {status === 'loading' && <Text tone="muted" size="sm">Reading…</Text>}
        </div>
      ) : null}

      {error !== null && <Text as="p">{error}</Text>}

      {review && (status === 'review' || status === 'committing') && (
        <>
          {review.parseErrors.length > 0 && (
            <ul className={styles.errors}>
              {review.parseErrors.map((e) => (
                <li key={e.rowNumber}>
                  <Text as="p" size="sm">
                    Row {e.rowNumber}: {e.error}
                  </Text>
                </li>
              ))}
            </ul>
          )}
          <ul className={styles.rows}>
            {review.matchedRows.map((matched) => (
              <li key={matched.row.rowNumber} className={styles.row}>
                <div className={styles.rowMain}>
                  <Text as="span">{matched.row.name}</Text>
                  {matched.supports.kind === 'matched' && (
                    <Text as="span" tone="muted" size="sm">
                      supports: {matched.supports.capability.name}
                    </Text>
                  )}
                  {matched.supports.kind === 'unresolved' && (
                    <Text as="span" tone="muted" size="sm">
                      supports: &ldquo;{matched.supports.name}&rdquo; not found
                    </Text>
                  )}
                </div>
                <MatchCell
                  matched={matched}
                  onPick={(choice) => {
                    resolveMatch(matched.row.rowNumber, choice);
                  }}
                />
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={status === 'committing' || unresolvedCount > 0}
              onClick={() => {
                void commit().then((branchId) => {
                  if (!branchId) return;
                  setRef({ kind: 'branch', branchId });
                  void navigate(`/o/${orgSlug}/m/${modelSlug}/changes/${branchId}`);
                });
              }}
            >
              {status === 'committing' ? 'Importing…' : unresolvedCount > 0 ? `Resolve ${String(unresolvedCount)} row(s) first` : 'Import'}
            </Button>
            <Button variant="ghost" disabled={status === 'committing'} onClick={reset}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
