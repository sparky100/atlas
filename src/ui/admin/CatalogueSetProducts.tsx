import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { CapabilitySetItem, CapabilitySetOption } from '../../contracts/catalogueAdmin';
import {
  acceptLinkProposals, findProductsForCapability, findTokensUsedToday, finishCheckRun, listCapabilitySetItems, listCapabilitySets, listLibraryProductKeys,
  listLinkProposalInputs, rejectLinkProposals, saveFoundProducts, startCheckRun,
} from '../../db/catalogueAdmin';
import { FIND_DAILY_TOKEN_LIMIT } from '../../tools/catalogueFindProducts';
import {
  capabilitiesWithoutProduct, proposalFromFound, proposeLinks, SET_RUN_MAX_CAPABILITIES, setCounts,
  type LinkProposal, type ProductLinkRow, type ProposalProduct, type RejectedLinkRow,
} from '../../tools/catalogueLinkProposals';
import { splitByLibrary } from '../../tools/catalogueFindProducts';
import { supabase } from '../supabaseClient';
import { setLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

interface CapabilityResult {
  code: string;
  name: string;
  found: number;
  added: { productId: string; product: string; vendor: string }[];
  existing: { productId: string; product: string; vendor: string }[];
  dropped: number;
  error: string | null;
}

/**
 * The "Find products for a set" section of Waiting for review (step 6b). For
 * one published capability set it shows how many capabilities have a product,
 * proposes links from products already in the library (by the same code in
 * another version, or the same name, each with its reason), and lets an admin
 * run the 6a search over up to ten capabilities that have no product. Accepting
 * a link is an edit that goes through the guarded save; rejecting records who,
 * when and why. Nothing is published.
 */
export function CatalogueSetProducts({ onRunRecorded, onChanged }: { onRunRecorded?: () => void; onChanged?: () => void } = {}) {
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [setId, setSetId] = useState('');
  const [items, setItems] = useState<CapabilitySetItem[]>([]);
  const [products, setProducts] = useState<ProposalProduct[]>([]);
  const [links, setLinks] = useState<ProductLinkRow[]>([]);
  const [rejected, setRejected] = useState<RejectedLinkRow[]>([]);
  const [extra, setExtra] = useState<LinkProposal[]>([]);
  const [pickedLinks, setPickedLinks] = useState<Set<string>>(new Set());
  const [pickedCaps, setPickedCaps] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<CapabilityResult[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
    void Promise.all([listCapabilitySetItems(supabase, setId), listLinkProposalInputs(supabase)])
      .then(([nextItems, inputs]) => {
        if (!current) return;
        setItems(nextItems); setProducts(inputs.products); setLinks(inputs.links); setRejected(inputs.rejected);
      })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [setId, reloadKey]);

  const set = sets.find((candidate) => candidate.id === setId) ?? null;
  const proposals = useMemo(() => {
    if (set === null) return [];
    const byRule = proposeLinks(set, items, products, links, sets, rejected);
    const taken = new Set(byRule.map((proposal) => proposal.key));
    return [...byRule, ...extra.filter((proposal) => !taken.has(proposal.key))];
  }, [set, items, products, links, sets, rejected, extra]);
  const counts = useMemo(() => (set === null ? null : setCounts(set, items, links, proposals)), [set, items, links, proposals]);
  const gaps = useMemo(() => {
    if (set === null) return [];
    const needle = query.trim().toLowerCase();
    return capabilitiesWithoutProduct(set, items, links).filter((item) => needle === '' || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle));
  }, [set, items, links, query]);
  const groups = useMemo(() => {
    const byProduct = new Map<string, { product: string; vendor: string; rows: LinkProposal[] }>();
    for (const proposal of proposals) {
      const group = byProduct.get(proposal.productId) ?? { product: proposal.product, vendor: proposal.vendor, rows: [] };
      group.rows.push(proposal);
      byProduct.set(proposal.productId, group);
    }
    return [...byProduct.entries()];
  }, [proposals]);

  const refresh = () => { setReloadKey((key) => key + 1); onChanged?.(); };
  const toggleLink = (key: string, on: boolean) => { setPickedLinks((current) => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; }); };
  const toggleCap = (code: string, on: boolean) => {
    setPickedCaps((current) => {
      const next = new Set(current);
      if (on && next.size < SET_RUN_MAX_CAPABILITIES) next.add(code); else next.delete(code);
      return next;
    });
  };
  const chosenLinks = proposals.filter((proposal) => pickedLinks.has(proposal.key));

  const accept = async () => {
    if (set === null || chosenLinks.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await acceptLinkProposals(supabase, set.id, chosenLinks);
      setPickedLinks(new Set());
      setExtra((current) => current.filter((proposal) => !result.accepted.includes(proposal.key)));
      setNotice(`${String(result.accepted.length)} link${result.accepted.length === 1 ? '' : 's'} accepted and added to the products as edits. Published products show “published, with changes” until you republish them.${result.failed.length > 0 ? ` ${result.failed.map((row) => `${row.product}: ${row.message}`).join(' ')}` : ''}`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (set === null || chosenLinks.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await rejectLinkProposals(supabase, set.id, chosenLinks, reason);
      setPickedLinks(new Set()); setReason('');
      setExtra((current) => current.filter((proposal) => !chosenLinks.some((row) => row.key === proposal.key)));
      setNotice(`${String(chosenLinks.length)} link${chosenLinks.length === 1 ? '' : 's'} rejected. They will not be proposed again.`);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (set === null) return;
    const chosen = capabilitiesWithoutProduct(set, items, links).filter((item) => pickedCaps.has(item.code));
    if (chosen.length === 0) return;
    stopRequested.current = false;
    setRunning(true); setError(''); setNotice(''); setResults(null);
    const runId = await startCheckRun(supabase, 'find_set').catch(() => null);
    const out: CapabilityResult[] = [];
    const tokens = { input: 0, output: 0 };
    let searches = 0;
    let savedTotal = 0;
    let status: 'finished' | 'stopped' | 'limit_reached' | 'failed' = 'finished';
    let note: string | null = null;
    const newProposals: LinkProposal[] = [];
    try {
      const usedBefore = await findTokensUsedToday(supabase);
      for (const [index, capability] of chosen.entries()) {
        if (stopped()) { status = 'stopped'; break; }
        if (usedBefore + tokens.input + tokens.output >= FIND_DAILY_TOKEN_LIMIT) { status = 'limit_reached'; note = 'The daily limit for finding products was reached.'; break; }
        setProgress(`Capability ${String(index + 1)} of ${String(chosen.length)}: ${capability.name}… ${String(savedTotal)} added so far`);
        const item = items.find((candidate) => candidate.code === capability.code);
        const definition = (item?.description ?? '').trim() === '' ? capability.name : (item?.description ?? '').trim();
        try {
          const result = await findProductsForCapability(supabase, { capabilityName: capability.name, capabilityDefinition: definition.slice(0, 1000), sector: set.sector });
          tokens.input += result.inputTokens; tokens.output += result.outputTokens; searches += result.searches;
          const library = await listLibraryProductKeys(supabase);
          const split = splitByLibrary(result.found, library.map((row) => ({ id: row.id, vendor: row.vendor, product: row.product })));
          const saving = await saveFoundProducts(supabase, split.added, { capabilityMapId: set.id, capabilityCode: capability.code, capabilityName: capability.name }, new Set(library.map((row) => row.code)), new Date().toISOString().slice(0, 10));
          savedTotal += saving.saved.length;
          for (const row of split.existing) {
            const proposal = proposalFromFound(row, capability, set, links, rejected);
            if (proposal !== null) newProposals.push(proposal);
          }
          out.push({ code: capability.code, name: capability.name, found: result.found.length, added: saving.saved, existing: split.existing.map((row) => ({ productId: row.productId, product: row.product, vendor: row.vendor })), dropped: result.dropped.length, error: saving.failed.length > 0 ? `${String(saving.failed.length)} could not be saved.` : null });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          out.push({ code: capability.code, name: capability.name, found: 0, added: [], existing: [], dropped: 0, error: message });
          if (message.includes('daily AI limit')) { status = 'limit_reached'; note = message; break; }
          if (message.includes('Web search is not switched on') || message.includes('no platform AI key')) { status = 'failed'; note = message; break; }
        }
      }
      if (status === 'stopped') note = `Stopped after ${String(out.length)} of ${String(chosen.length)} capabilities.`;
      else note ??= `Searched ${String(out.length)} capabilities.`;
      setResults(out);
      setExtra((current) => [...current, ...newProposals]);
      if (status === 'limit_reached') setError(`${note} What was found so far is saved.`);
      else if (status === 'failed') setError(`${note} What was found so far is saved.`);
      else setNotice(note);
    } catch (cause) {
      status = 'failed';
      note = cause instanceof Error ? cause.message : String(cause);
      setError(`${note} What was found so far is saved.`);
    } finally {
      if (runId !== null) {
        await finishCheckRun(supabase, runId, { status, linksChecked: 0, claimsChecked: 0, flagged: 0, searches, productsFound: savedTotal, tokens, note }).catch(() => undefined);
        onRunRecorded?.();
      }
      setPickedCaps(new Set());
      setRunning(false); setProgress('');
      refresh();
    }
  };

  return (
    <section className={styles.panel} aria-label="Find products for a set" data-testid="set-products">
      <div className={styles.panelHeader}>
        <div>
          <h2>Find products for a set</h2>
          <p>
            Choose a published capability set. Links are proposed from products already in the library, and you can search for products for capabilities that have none. Nothing goes live until a person reviews and publishes.
          </p>
        </div>
      </div>
      {loading ? <p>Loading…</p> : sets.length === 0 ? <p>No capability set is published yet.</p> : (
        <>
          <div className={styles.fields}>
            <label>
              Capability set
              <select value={setId} onChange={(event) => { setSetId(event.target.value); setPickedLinks(new Set()); setPickedCaps(new Set()); setExtra([]); setResults(null); setItems([]); }} disabled={running}>
                {sets.map((option) => <option key={option.id} value={option.id}>{setLabel(option)}</option>)}
              </select>
            </label>
          </div>
          {counts !== null && (
            <p data-testid="set-products-counts">
              {String(counts.capabilities)} capabilities, {String(counts.withProduct)} with a product, {String(counts.without)} with none, {String(counts.proposed)} link{counts.proposed === 1 ? '' : 's'} proposed from products already in the library.
            </p>
          )}

          <h3>Proposed links</h3>
          {proposals.length === 0 ? <p>No links to propose. Products already linked by code or name are not shown again.</p> : (
            <div data-testid="set-products-proposals">
              {groups.map(([productId, group]) => (
                <div key={productId} className={styles.queueProduct}>
                  <header><h4><Link to={`/platform-admin/catalogue/products/${productId}`}>{group.product}</Link> <small>{group.vendor}</small></h4></header>
                  {group.rows.map((row) => (
                    <label key={row.key} className={styles.checkLine}>
                      <input type="checkbox" aria-label={`${row.name} (${row.code})`} checked={pickedLinks.has(row.key)} onChange={(event) => { toggleLink(row.key, event.target.checked); }} disabled={busy || running} />
                      <span><strong>{row.name}</strong> <small>{row.code}</small><br /><small>Proposed by a rule. {row.why}</small></span>
                    </label>
                  ))}
                </div>
              ))}
              <div className={styles.fields}>
                <label>
                  Reason for rejecting
                  <input type="text" value={reason} onChange={(event) => { setReason(event.target.value); }} maxLength={300} disabled={busy || running} />
                </label>
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={() => { void accept(); }} disabled={busy || running || chosenLinks.length === 0}>Accept {String(chosenLinks.length)} selected</button>
                <button type="button" onClick={() => { void reject(); }} disabled={busy || running || chosenLinks.length === 0 || reason.trim() === ''}>Reject {String(chosenLinks.length)} selected</button>
              </div>
            </div>
          )}

          <h3>Capabilities with no product</h3>
          {counts !== null && counts.without === 0 ? <p>Every capability in this set has a product.</p> : (
            <>
              <div className={styles.fields}>
                <label>
                  Search these capabilities
                  <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} disabled={running} />
                </label>
              </div>
              <div className={styles.scroll} aria-label="Capabilities with no product" data-testid="set-products-gaps">
                {gaps.map((item) => (
                  <label key={item.code} className={styles.checkLine}>
                    <input type="checkbox" checked={pickedCaps.has(item.code)} onChange={(event) => { toggleCap(item.code, event.target.checked); }} disabled={running || (!pickedCaps.has(item.code) && pickedCaps.size >= SET_RUN_MAX_CAPABILITIES)} />
                    <span>{item.name} <small>{item.code}</small></span>
                  </label>
                ))}
              </div>
              <p>
                {String(pickedCaps.size)} of at most {String(SET_RUN_MAX_CAPABILITIES)} chosen. The daily limit of {FIND_DAILY_TOKEN_LIMIT.toLocaleString('en-GB')} tokens for finding products is shared with the single-capability search. Only each capability’s name and definition, the sector and the word “product” are sent to the AI.
              </p>
              <div className={styles.actions}>
                <button type="button" onClick={() => { void run(); }} disabled={running || pickedCaps.size === 0}>Find products for these</button>
                {running && <button type="button" onClick={() => { stopRequested.current = true; }}>Stop</button>}
              </div>
              {running && progress !== '' && <p role="status">{progress}</p>}
            </>
          )}
        </>
      )}
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {results !== null && (
        <div data-testid="set-products-result">
          <h3>Result</h3>
          <ul>
            {results.map((row) => (
              <li key={row.code}>
                <strong>{row.name}</strong>: {row.error !== null && row.found === 0 ? `not searched (${row.error})` : `${String(row.found)} found, ${String(row.existing.length)} already in the library, ${String(row.added.length)} added for review${row.dropped > 0 ? `, ${String(row.dropped)} dropped` : ''}.`}
                {row.added.length > 0 && <> {row.added.map((product) => <Link key={product.productId} to={`/platform-admin/catalogue/products/${product.productId}`}>{product.product}</Link>)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
