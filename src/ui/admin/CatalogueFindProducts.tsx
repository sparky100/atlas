import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CapabilitySetItem, CapabilitySetOption } from '../../contracts/catalogueAdmin';
import { findProductsForCapability, finishCheckRun, listCapabilitySetItems, listCapabilitySets, listLibraryProductKeys, saveFoundProducts, startCheckRun } from '../../db/catalogueAdmin';
import { FIND_DAILY_TOKEN_LIMIT, FIND_MAX_PRODUCTS, FIND_MAX_SEARCHES, splitByLibrary, type FindResult } from '../../tools/catalogueFindProducts';
import { supabase } from '../supabaseClient';
import { formatDay, sectorLabel, setLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

interface Outcome {
  capability: string;
  searched: number;
  found: number;
  existing: { productId: string; product: string; vendor: string }[];
  saved: { productId: string; product: string; vendor: string }[];
  failed: { product: string; message: string }[];
  dropped: { product: string; vendor: string; reason: string }[];
  note: string | null;
}

/**
 * The "Find new products" section of Waiting for review (step 6a). An admin
 * picks one capability from a published set and presses a button; the platform
 * AI searches the public web, every claim must quote its page, products already
 * in the library are shown and not duplicated, and new ones are saved as drafts
 * linked to that capability and marked "Found by the Researcher". Nothing is
 * published. Only the capability's name and definition, the sector and the word
 * "product" are sent to the AI: no organisation data exists on this screen.
 */
export function CatalogueFindProducts({ onRunRecorded }: { onRunRecorded?: () => void } = {}) {
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [setId, setSetId] = useState('');
  const [items, setItems] = useState<CapabilitySetItem[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CapabilitySetItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const stopRequested = useRef(false);
  const stopped = () => stopRequested.current;

  useEffect(() => {
    void listCapabilitySets(supabase)
      .then((all) => {
        const published = all.filter((set) => set.status === 'published');
        setSets(published);
        setSetId(published[0]?.id ?? '');
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    if (setId === '') return;
    let current = true;
    void listCapabilitySetItems(supabase, setId)
      .then((next) => { if (current) setItems(next); })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [setId]);

  const set = sets.find((candidate) => candidate.id === setId) ?? null;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => needle === '' || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle)).slice(0, 50);
  }, [items, query]);

  const run = async () => {
    if (picked === null || set === null) return;
    stopRequested.current = false;
    setRunning(true); setError(''); setNotice(''); setOutcome(null);
    const definition = (picked.description ?? '').trim() === '' ? picked.name : (picked.description ?? '').trim();
    // The run record is best effort: a failure to record it never stops or hides the search itself.
    const runId = await startCheckRun(supabase, 'find').catch(() => null);
    let status: 'finished' | 'stopped' | 'limit_reached' | 'failed' = 'finished';
    let note: string | null = null;
    let result: FindResult | null = null;
    let savedCount = 0;
    try {
      result = await findProductsForCapability(supabase, { capabilityName: picked.name, capabilityDefinition: definition.slice(0, 1000), sector: set.sector });
      if (stopped()) {
        status = 'stopped';
        setNotice('Stopped. Nothing was added.');
      } else {
        const library = await listLibraryProductKeys(supabase);
        const split = splitByLibrary(result.found, library.map((row) => ({ id: row.id, vendor: row.vendor, product: row.product })));
        const today = new Date().toISOString().slice(0, 10);
        const saving = await saveFoundProducts(supabase, split.added, { capabilityMapId: set.id, capabilityCode: picked.code, capabilityName: picked.name }, new Set(library.map((row) => row.code)), today);
        savedCount = saving.saved.length;
        setOutcome({
          capability: picked.name, searched: result.searches, found: result.found.length,
          existing: split.existing.map((row) => ({ productId: row.productId, product: row.product, vendor: row.vendor })),
          saved: saving.saved, failed: saving.failed, dropped: result.dropped, note: result.note ?? null,
        });
        if (saving.failed.length > 0) note = `${String(saving.failed.length)} could not be saved.`;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      status = message.includes('daily AI limit') ? 'limit_reached' : 'failed';
      note = message;
      setError(`${message} Nothing was added.`);
    } finally {
      if (runId !== null) {
        await finishCheckRun(supabase, runId, {
          status, linksChecked: 0, claimsChecked: 0, flagged: 0, searches: result?.searches ?? 0, productsFound: savedCount,
          tokens: { input: result?.inputTokens ?? 0, output: result?.outputTokens ?? 0 }, note,
        }).catch(() => undefined);
        onRunRecorded?.();
      }
      setRunning(false);
    }
  };

  const today = formatDay(new Date().toISOString());

  return (
    <section className={styles.panel} aria-label="Find new products" data-testid="find-products">
      <div className={styles.panelHeader}>
        <div>
          <h2>Find new products</h2>
          <p>
            Choose a capability from a published set. The Researcher searches the public web for products that support it. Nothing goes live: every product it adds is a draft that a person reviews and publishes.
          </p>
        </div>
      </div>
      {loading ? <p>Loading…</p> : sets.length === 0 ? <p>No capability set is published yet, so there is nothing to search for.</p> : (
        <>
          <div className={styles.fields}>
            <label>
              Capability set
              <select value={setId} onChange={(event) => { setSetId(event.target.value); setPicked(null); setItems([]); setQuery(''); }} disabled={running}>
                {sets.map((option) => <option key={option.id} value={option.id}>{setLabel(option)}</option>)}
              </select>
            </label>
            <label>
              Search the capabilities
              <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="For example: customer billing" disabled={running} />
            </label>
          </div>
          <div className={styles.scroll} role="listbox" aria-label="Capabilities">
            {matches.length === 0 && <p>No capability matches.</p>}
            {matches.map((item) => (
              <button key={item.id} type="button" role="option" aria-selected={picked?.id === item.id} className={picked?.id === item.id ? styles.active : undefined} onClick={() => { setPicked(item); }} disabled={running}>
                {item.name} <small>{item.code}</small>
              </button>
            ))}
          </div>
          {picked !== null && set !== null && (
            <p data-testid="find-products-sends">
              Selected: <strong>{picked.name}</strong> ({sectorLabel(set.sector)}). What will be sent to the AI: the capability’s name and definition, the sector, and the word “product”. No organisation data is on this screen to send. Up to {String(FIND_MAX_SEARCHES)} searches and {String(FIND_MAX_PRODUCTS)} products per run; a daily limit of {FIND_DAILY_TOKEN_LIMIT.toLocaleString('en-GB')} tokens applies to finding products.
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" onClick={() => { void run(); }} disabled={picked === null || running}>Find products for this capability</button>
            {running && <button type="button" onClick={() => { stopRequested.current = true; }}>Stop</button>}
          </div>
          {running && <p role="status">Searching and reading pages… this can take a few minutes. Stop keeps anything already added; nothing is added until the pages have been read.</p>}
        </>
      )}
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {outcome !== null && (
        <div data-testid="find-products-result">
          {outcome.found === 0 && outcome.dropped.length === 0
            ? <p>No new products found for {outcome.capability}.{outcome.note === null ? '' : ` ${outcome.note}`}</p>
            : (
              <p>
                {String(outcome.found)} product{outcome.found === 1 ? '' : 's'} found, {String(outcome.existing.length)} already in the library, {String(outcome.saved.length)} added for review.
                {outcome.dropped.length > 0 ? ` ${String(outcome.dropped.length)} dropped.` : ''}
              </p>
            )}
          {outcome.saved.length > 0 && (
            <>
              <h3>Added for review</h3>
              <ul>
                {outcome.saved.map((row) => (
                  <li key={row.productId}>
                    <Link to={`/platform-admin/catalogue/products/${row.productId}`}>{row.product}</Link> ({row.vendor}). Draft, found by the Researcher on {today}. Its claims are in the list below, waiting for review.
                  </li>
                ))}
              </ul>
            </>
          )}
          {outcome.existing.length > 0 && (
            <>
              <h3>Already in the library</h3>
              <ul>
                {outcome.existing.map((row) => <li key={row.productId}><Link to={`/platform-admin/catalogue/products/${row.productId}`}>{row.product}</Link> ({row.vendor})</li>)}
              </ul>
            </>
          )}
          {outcome.dropped.length > 0 && (
            <>
              <h3>Dropped</h3>
              <ul>{outcome.dropped.map((row) => <li key={`${row.vendor}\u0000${row.product}`}>{row.product} ({row.vendor}): {row.reason}</li>)}</ul>
            </>
          )}
          {outcome.failed.length > 0 && (
            <>
              <h3>Could not be saved</h3>
              <ul>{outcome.failed.map((row) => <li key={row.product}>{row.product}: {row.message}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
