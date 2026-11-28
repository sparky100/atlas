import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { listLibraryProductKeys, loadResearch } from '../../db/catalogueAdmin';
import {
  groupResearch, parseResearch, platformsToCreate, RESEARCH_COLUMNS, RESEARCH_MAX_ROWS, RESEARCH_PROMPT,
  type ResearchItem, type ResearchProblem,
} from '../../tools/catalogueResearchImport';
import { supabase } from '../supabaseClient';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/catalogue';

interface Checked { items: ResearchItem[]; problems: ResearchProblem[] }
interface Loaded { saved: { productId: string; product: string }[]; skipped: string[]; failed: { product: string; message: string }[]; platformsCreated: string[] }

/**
 * "Load your own research". An admin researches products or a platform's
 * modules any way they like (a spreadsheet, or an AI chat using the prompt
 * offered here), pastes the table, checks it, and loads the new rows as drafts.
 * Nothing on this screen is sent to an AI. Products already in the library are
 * shown and left as they are (rule I1). Every claim is drafted by the person
 * who loads it and waits for review; nothing is published.
 */
export function CatalogueLoadResearch() {
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const newItems = useMemo(() => (checked?.items ?? []).filter((item) => item.existingId === null), [checked]);
  const existingItems = useMemo(() => (checked?.items ?? []).filter((item) => item.existingId !== null), [checked]);
  const chosen = useMemo(() => newItems.filter((item) => !unticked.has(item.key)), [newItems, unticked]);
  const newPlatforms = useMemo(() => platformsToCreate(chosen), [chosen]);
  const claimCount = chosen.reduce((total, item) => total + item.claims.length, 0);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied('Copying was blocked by the browser. Select the text below and copy it yourself.');
    }
  };

  const check = async () => {
    setChecking(true); setError(''); setLoaded(null); setUnticked(new Set());
    try {
      const parsed = parseResearch(text);
      const library = await listLibraryProductKeys(supabase);
      setChecked({ items: groupResearch(parsed.rows, library), problems: parsed.problems });
    } catch (cause) {
      setError(errorText(cause));
      setChecked(null);
    } finally {
      setChecking(false);
    }
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await loadResearch(supabase, chosen, new Date().toISOString().slice(0, 10));
      setLoaded(result);
      setChecked(null);
      if (result.failed.length === 0) setText('');
    } catch (cause) {
      setError(`${errorText(cause)} Nothing more was loaded.`);
    } finally {
      setLoading(false);
    }
  };

  const busy = checking || loading;
  return (
    <section className={styles.panel} aria-label="Load your own research" data-testid="load-research">
      <p>
        Research products or a platform’s modules your own way, in a spreadsheet or an AI chat, then paste the table here. One row is one claim: a product with several sources has several rows. New products are added as drafts with your name on every claim, waiting for review. Products already in the library are shown and left as they are. Nothing on this screen is sent to an AI, and nothing goes live.
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={() => { void copy('The research prompt is copied. Paste it into any AI chat and add what to research at the end.', RESEARCH_PROMPT); }}>Copy the research prompt</button>
        <button type="button" onClick={() => { void copy('The blank table is copied. Paste it into a spreadsheet.', RESEARCH_COLUMNS.join('\t')); }}>Copy a blank table</button>
      </div>
      {copied !== '' && <p role="status">{copied}</p>}
      <details>
        <summary>See the research prompt</summary>
        <pre className={styles.prompt} data-testid="load-research-prompt">{RESEARCH_PROMPT}</pre>
      </details>
      <div className={styles.fields}>
      <label>
        Paste your table (with its header row, up to {String(RESEARCH_MAX_ROWS)} rows)
        <textarea
          rows={8} value={text} disabled={busy} data-testid="load-research-text"
          placeholder={RESEARCH_COLUMNS.join(' | ')}
          onChange={(event) => { setText(event.target.value); setChecked(null); setLoaded(null); }}
        />
      </label>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => { void check(); }} disabled={text.trim() === '' || busy}>{checking ? 'Checking…' : 'Check the rows'}</button>
      </div>
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {checked !== null && (
        <div data-testid="load-research-preview">
          {checked.problems.length > 0 && (
            <div data-testid="load-research-problems">
              <h3>Rows that will not be loaded ({String(checked.problems.length)})</h3>
              <p>Fix these in your table and check again, or load the rest now.</p>
              <ul>{checked.problems.map((problem) => <li key={`${String(problem.line)}-${problem.text}`}>{problem.text}</li>)}</ul>
            </div>
          )}
          {newItems.length > 0 && (
            <div data-testid="load-research-new">
              <h3>New to the library ({String(newItems.length)})</h3>
              <p>Untick any you do not want. Nothing is saved until you press the button.</p>
              <ul>
                {newItems.map((item) => (
                  <li key={item.key}>
                    <label>
                      <input
                        type="checkbox" checked={!unticked.has(item.key)} disabled={busy}
                        onChange={(event) => { setUnticked((current) => { const next = new Set(current); if (event.target.checked) next.delete(item.key); else next.add(item.key); return next; }); }}
                      />
                      {' '}<strong>{item.product}</strong> ({item.vendor}){item.platform === null ? '' : `, a module of ${item.platform}${item.platformId === null ? '' : ' (already in the library)'}`}. {item.summary}{' '}
                      {String(item.claims.length)} claim{item.claims.length === 1 ? '' : 's'}.{item.note === null ? '' : ` ${item.note}`}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {existingItems.length > 0 && (
            <p data-testid="load-research-existing">
              Already in the library, left as they are: {existingItems.map((item, index) => <span key={item.key}>{index > 0 ? ', ' : ''}<Link to={`${BASE}/products/${item.existingId ?? ''}`}>{item.product}</Link></span>)}. To add a source to one of them, open it and add the claim there.
            </p>
          )}
          {newItems.length === 0 && existingItems.length === 0 && <p role="status">No rows could be loaded.</p>}
          {chosen.length > 0 && (
            <>
              <p>
                {`This adds ${String(chosen.length)} draft product${chosen.length === 1 ? '' : 's'} with ${String(claimCount)} claim${claimCount === 1 ? '' : 's'}`}
                {newPlatforms.length > 0 ? `, and first adds ${newPlatforms.map((row) => row.product).join(', ')} as draft platform${newPlatforms.length === 1 ? '' : 's'}` : ''}. No capability links are made: link each one from its page.
              </p>
              <div className={styles.actions}>
                <button type="button" onClick={() => { void load(); }} disabled={busy}>{loading ? 'Loading…' : `Load ${String(chosen.length)} as drafts`}</button>
              </div>
            </>
          )}
        </div>
      )}
      {loaded !== null && (
        <div data-testid="load-research-done">
          <h3>Loaded for review</h3>
          {loaded.saved.length > 0 ? (
            <ul>{loaded.saved.map((row) => <li key={row.productId}><Link to={`${BASE}/products/${row.productId}`}>{row.product}</Link>: draft, claims drafted by you, waiting for review.</li>)}</ul>
          ) : <p>Nothing new was saved.</p>}
          {loaded.platformsCreated.length > 0 && <p>Draft platforms added first: {loaded.platformsCreated.join(', ')}. Each needs a sourced description before it can be published.</p>}
          {loaded.skipped.length > 0 && <p>Already in the library when loading, so left as they are: {loaded.skipped.join(', ')}.</p>}
          {loaded.failed.length > 0 && (
            <div role="alert" className={styles.error}>
              <p>These could not be saved, and nothing of them was kept:</p>
              <ul>{loaded.failed.map((row) => <li key={row.product}>{row.product}: {row.message}</li>)}</ul>
            </div>
          )}
          <p>Next: link each product to the capabilities it meets from its page, and run “Check source links and claims” to confirm the quoted sentences are on the pages.</p>
        </div>
      )}
    </section>
  );
}
