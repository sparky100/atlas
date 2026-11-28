import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { addPlatform, findAndSaveComponents, findPlatformsForSector, finishCheckRun, listCapabilitySets, listLibraryProductKeys, startCheckRun } from '../../db/catalogueAdmin';
import { FIND_DAILY_TOKEN_LIMIT, FIND_MAX_PLATFORMS, splitByLibrary, type FindResult } from '../../tools/catalogueFindProducts';
import { supabase } from '../supabaseClient';
import { sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/catalogue';

interface PlatformRow { product: string; vendor: string; summary: string; source: string }
interface Done { product: string; platformId: string; saved: number; found: number; existingModules: number; note: string | null }

/**
 * "Find the main platforms for a sector" (step 2 of the collection fix). An
 * admin picks a sector from the published sets; one AI search lists the main
 * platforms, each backed by a quoted sentence on a public page. Platforms
 * already in the library are shown and not offered again. The admin ticks the
 * ones to add; each is saved as a draft platform and its modules are searched
 * for, one platform at a time, with a Stop button. Nothing is published, and
 * only the sector name is sent to the AI.
 */
export function CatalogueFindPlatforms({ onRunRecorded }: { onRunRecorded?: () => void } = {}) {
  const [sectors, setSectors] = useState<string[]>([]);
  const [sector, setSector] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offered, setOffered] = useState<PlatformRow[] | null>(null);
  const [existing, setExisting] = useState<{ productId: string; product: string }[]>([]);
  const [dropped, setDropped] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState<Done[]>([]);
  const stopRequested = useRef(false);
  const stopped = () => stopRequested.current;

  useEffect(() => {
    void listCapabilitySets(supabase)
      .then((all) => {
        const list = [...new Set(all.filter((set) => set.status === 'published').map((set) => set.sector))].sort();
        setSectors(list);
        setSector(list[0] ?? '');
      })
      .catch((cause: unknown) => { setError(errorText(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const keyOf = (row: PlatformRow) => `${row.vendor}\u0000${row.product}`;
  const tickedRows = useMemo(() => (offered ?? []).filter((row) => ticked.has(keyOf(row))), [offered, ticked]);

  const search = async () => {
    setSearching(true); setError(''); setNotice(''); setOffered(null); setExisting([]); setDone([]); setTicked(new Set());
    const runId = await startCheckRun(supabase, 'find').catch(() => null);
    let status: 'finished' | 'failed' | 'limit_reached' = 'finished';
    let note: string | null = null;
    let result: FindResult | null = null;
    try {
      result = await findPlatformsForSector(supabase, { sector: sectorLabel(sector) });
      const library = await listLibraryProductKeys(supabase);
      const split = splitByLibrary(result.found, library.map((row) => ({ id: row.id, vendor: row.vendor, product: row.product })));
      setOffered(split.added.map((item) => ({ product: item.product, vendor: item.vendor, summary: item.summary, source: item.claims[0]?.sourceUrl ?? '' })));
      setExisting(split.existing.map((row) => ({ productId: row.productId, product: row.product })));
      setDropped(result.dropped.length);
      if (result.found.length === 0) setNotice(result.note ?? 'No platforms were found with a quoted sentence on a public page.');
    } catch (cause) {
      const message = errorText(cause);
      status = message.includes('daily AI limit') ? 'limit_reached' : 'failed';
      note = message;
      setError(`${message} Nothing was added.`);
    } finally {
      if (runId !== null) {
        await finishCheckRun(supabase, runId, {
          status, linksChecked: 0, claimsChecked: 0, flagged: 0, searches: result?.searches ?? 0, productsFound: 0,
          tokens: { input: result?.inputTokens ?? 0, output: result?.outputTokens ?? 0 }, note,
        }).catch(() => undefined);
        onRunRecorded?.();
      }
      setSearching(false);
    }
  };

  const addAll = async () => {
    stopRequested.current = false;
    setAdding(true); setError(''); setNotice(''); setDone([]);
    const today = new Date().toISOString().slice(0, 10);
    const rows = tickedRows;
    const finished: Done[] = [];
    try {
      for (const [index, row] of rows.entries()) {
        if (stopped()) { setNotice(`Stopped after ${String(index)} of ${String(rows.length)}. What was added stays as drafts.`); break; }
        setProgress(`${String(index + 1)} of ${String(rows.length)}: ${row.product}`);
        const added = await addPlatform(supabase, row.vendor, row.product);
        const outcome = await findAndSaveComponents(supabase, { id: added.platformId, product: added.product, vendor: row.vendor }, [], today);
        finished.push({ product: added.product, platformId: added.platformId, saved: outcome.saved.length, found: outcome.found, existingModules: outcome.existing.length, note: outcome.note });
        setDone([...finished]);
        onRunRecorded?.();
      }
    } catch (cause) {
      const message = errorText(cause);
      setError(message.includes('daily AI limit')
        ? `The daily AI limit was reached after ${String(finished.length)} of ${String(rows.length)} platforms. Continue tomorrow: the ones added stay as drafts.`
        : `${message} ${String(finished.length)} of ${String(rows.length)} platforms were done.`);
    } finally {
      setAdding(false); setProgress('');
    }
  };

  const busy = searching || adding;
  return (
    <section className={styles.panel} aria-label="Find the main platforms for a sector" data-testid="find-platforms">
      <p>
        Choose a sector. The Researcher searches the public web for the main platforms organisations in it run, and shows them for you to tick. Each one you add is a draft platform, and its modules are then searched for. Nothing goes live: a person reviews and publishes.
      </p>
      {loading ? <p>Loading…</p> : sectors.length === 0 ? <p>No capability set is published yet, so there is no sector to search.</p> : (
        <>
          <div className={styles.fields}>
            <label>
              Sector
              <select value={sector} onChange={(event) => { setSector(event.target.value); setOffered(null); setDone([]); }} disabled={busy}>
                {sectors.map((option) => <option key={option} value={option}>{sectorLabel(option)}</option>)}
              </select>
            </label>
          </div>
          <p data-testid="find-platforms-sends">
            What will be sent to the AI: the sector name and the word “platform”. No organisation data is on this screen to send. Up to {String(FIND_MAX_PLATFORMS)} platforms per search; a daily limit of {FIND_DAILY_TOKEN_LIMIT.toLocaleString('en-GB')} tokens applies to finding, and each platform’s module search uses part of it.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={() => { void search(); }} disabled={sector === '' || busy}>{searching ? 'Searching…' : `Find the main platforms for ${sectorLabel(sector)}`}</button>
          </div>
        </>
      )}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}
      {offered !== null && offered.length > 0 && (
        <div data-testid="find-platforms-offered">
          <h3>Platforms found ({String(offered.length)})</h3>
          <p>Tick the ones to add. Nothing is saved until you press the button.</p>
          <ul>
            {offered.map((row) => (
              <li key={keyOf(row)}>
                <label>
                  <input
                    type="checkbox" checked={ticked.has(keyOf(row))} disabled={busy}
                    onChange={(event) => { setTicked((current) => { const next = new Set(current); if (event.target.checked) next.add(keyOf(row)); else next.delete(keyOf(row)); return next; }); }}
                  />
                  {' '}<strong>{row.product}</strong> ({row.vendor}). {row.summary}{' '}
                  <a href={row.source} target="_blank" rel="noreferrer">Source</a>
                </label>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" onClick={() => { void addAll(); }} disabled={tickedRows.length === 0 || busy}>
              {adding ? 'Working…' : `Add ${String(tickedRows.length)} and find their components`}
            </button>
            {adding && <button type="button" onClick={() => { stopRequested.current = true; }}>Stop</button>}
          </div>
          {adding && <p role="status">{progress}. Each platform can take a few minutes.</p>}
        </div>
      )}
      {existing.length > 0 && (
        <p>Already in the library and not offered again: {existing.map((row, index) => <span key={row.productId}>{index > 0 ? ', ' : ''}<Link to={`${BASE}/products/${row.productId}`}>{row.product}</Link></span>)}.</p>
      )}
      {dropped > 0 && <p>{String(dropped)} dropped because no quoted sentence on the vendor’s page backed them.</p>}
      {done.length > 0 && (
        <div data-testid="find-platforms-done">
          <h3>Added for review</h3>
          <ul>
            {done.map((row) => (
              <li key={row.platformId}>
                <Link to={`${BASE}/products/${row.platformId}`}>{row.product}</Link>: {String(row.saved)} module{row.saved === 1 ? '' : 's'} added as drafts{row.existingModules > 0 ? `, ${String(row.existingModules)} already in the library` : ''}. Draft, found by the Researcher.{row.note === null ? '' : ` ${row.note}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
