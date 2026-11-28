import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CapabilitySetOption } from '../../contracts/catalogueAdmin';
import { listCapabilitySets, readSetCoverage } from '../../db/catalogueAdmin';
import type { CoverageGroup, CoverageRow } from '../../tools/catalogueCoverage';
import { supabase } from '../supabaseClient';
import { setLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/catalogue';

type Report = Awaited<ReturnType<typeof readSetCoverage>>;

const stateText = (row: CoverageRow) =>
  row.state === 'published' ? `Published (${String(row.published.length)})` : row.state === 'draft_only' ? `Draft only (${String(row.drafts.length)})` : 'No product';

function ProductLinks({ row }: { row: CoverageRow }) {
  const list = [...row.published.map((product) => ({ product, draft: false })), ...row.drafts.map((product) => ({ product, draft: true }))];
  return (
    <>
      {list.map(({ product, draft }, index) => (
        <span key={product.id}>{index > 0 ? ', ' : ''}<Link to={`${BASE}/products/${product.id}`}>{product.product}</Link>{draft ? ' (draft)' : ''}</span>
      ))}
    </>
  );
}

function Group({ group, gapsOnly }: { group: CoverageGroup; gapsOnly: boolean }) {
  const rows = gapsOnly ? group.rows.filter((row) => row.state !== 'published') : group.rows;
  if (rows.length === 0) return null;
  const { counts } = group;
  return (
    <details open={group.general} data-testid={`coverage-group-${group.key}`}>
      <summary>
        {group.title}: {String(counts.published)} of {String(counts.total)} with a published product{counts.draftOnly > 0 ? `, ${String(counts.draftOnly)} draft only` : ''}, {String(counts.none)} with none
      </summary>
      <ul>
        {rows.map((row) => (
          <li key={row.id} data-testid="coverage-row" data-state={row.state}>
            <strong>{row.code}</strong> {row.name}: {stateText(row)}{row.state === 'none' ? '' : <>. <ProductLinks row={row} /></>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * "Coverage by sector": for one published capability set, which capabilities
 * have a published product, which have only drafts, and which have none.
 * General capabilities (shared by every sector) come first. Read only: to fill
 * a gap, use the search sections beside it.
 */
export function CatalogueCoverage() {
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [setId, setSetId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ id: string; report: Report | null; error: string } | null>(null);
  const [gapsOnly, setGapsOnly] = useState(false);

  useEffect(() => {
    void listCapabilitySets(supabase)
      .then((all) => {
        const published = all.filter((set) => set.status === 'published');
        setSets(published);
        setSetId(published[0]?.id ?? '');
      })
      .catch((cause: unknown) => { setError(errorText(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    if (setId === '') return;
    let current = true;
    void readSetCoverage(supabase, setId)
      .then((next) => { if (current) setResult({ id: setId, report: next, error: '' }); })
      .catch((cause: unknown) => { if (current) setResult({ id: setId, report: null, error: errorText(cause) }); });
    return () => { current = false; };
  }, [setId]);

  // The report on screen is only ever the one for the chosen set; while the next is read, nothing stale is shown.
  const current = result !== null && result.id === setId ? result : null;
  const reading = setId !== '' && current === null;
  const report = current?.report ?? null;

  const summary = useMemo(() => {
    if (report === null) return '';
    const { counts } = report;
    return `${String(counts.published)} of ${String(counts.total)} capabilities have a published product, ${String(counts.draftOnly)} have only drafts, ${String(counts.none)} have none.`;
  }, [report]);

  return (
    <section className={styles.panel} aria-label="Coverage by sector" data-testid="coverage">
      <p>
        Choose a published capability set to see which capabilities have a product. A product counts when it is linked at the same code in any version of the sector’s set, or through a general capability. Platforms and merged products are not counted. Nothing here changes anything.
      </p>
      {loading ? <p>Loading…</p> : sets.length === 0 ? <p>No capability set is published yet, so there is nothing to report on.</p> : (
        <>
          <div className={styles.fields}>
            <label>
              Capability set
              <select value={setId} onChange={(event) => { setSetId(event.target.value); }} disabled={reading}>
                {sets.map((option) => <option key={option.id} value={option.id}>{setLabel(option)}</option>)}
              </select>
            </label>
            <label className={styles.checkLine}>
              <input type="checkbox" checked={gapsOnly} onChange={(event) => { setGapsOnly(event.target.checked); }} /> Show gaps only
            </label>
          </div>
          {reading && <p role="status">Reading the library…</p>}
        </>
      )}
      {(error !== '' || (current?.error ?? '') !== '') && <p role="alert" className={styles.error}>{error !== '' ? error : current?.error}</p>}
      {report !== null && (
        <div data-testid="coverage-report">
          <p data-testid="coverage-summary"><strong>{summary}</strong></p>
          {report.groups.map((group) => <Group key={group.key} group={group} gapsOnly={gapsOnly} />)}
        </div>
      )}
    </section>
  );
}
