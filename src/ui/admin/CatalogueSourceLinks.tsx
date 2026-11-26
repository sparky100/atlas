import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { sourceCheckLabel, type SourceCheckRow } from '../../contracts/catalogueAdmin';
import { checkSourceLinks, listDistinctSourceUrls, listFlaggedSourceLinks, listSourceChecks, saveSourceChecks, type FlaggedSourceLink } from '../../db/catalogueAdmin';
import { LINK_CHECK_MAX_URLS } from '../../tools/catalogueLinkCheck';
import { supabase } from '../supabaseClient';
import { formatDay, sourceCheckSentence } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

/**
 * The "Source links" section of Waiting for review (step 5a). It asks the link
 * checker about each distinct source link in small batches, saves what comes
 * back as it goes, and lists every link that is not working so a person can fix
 * or replace the source. It never changes a claim or unpublishes anything.
 */
export function CatalogueSourceLinks() {
  const [urls, setUrls] = useState<string[]>([]);
  const [checks, setChecks] = useState<SourceCheckRow[]>([]);
  const [flagged, setFlagged] = useState<FlaggedSourceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const stopRequested = useRef(false);
  const stopped = () => stopRequested.current;

  useEffect(() => {
    void (async () => {
      try {
        const [nextUrls, nextChecks] = await Promise.all([listDistinctSourceUrls(supabase), listSourceChecks(supabase)]);
        setUrls(nextUrls);
        setChecks(nextChecks);
        setFlagged(await listFlaggedSourceLinks(supabase, nextChecks));
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const summary = useMemo(() => {
    const known = new Set(urls);
    const current = checks.filter((check) => known.has(check.url));
    const latest = current.reduce<SourceCheckRow | null>((best, check) => (best === null || check.checkedAt > best.checkedAt ? check : best), null);
    return { checked: current.length, latest };
  }, [urls, checks]);

  const run = async () => {
    stopRequested.current = false;
    setRunning(true); setError(''); setNotice('');
    let done = 0;
    setProgress({ done, total: urls.length });
    try {
      for (let from = 0; from < urls.length; from += LINK_CHECK_MAX_URLS) {
        if (stopped()) { setNotice(`Stopped after ${String(done)} of ${String(urls.length)} links. The results so far are saved.`); break; }
        const batch = urls.slice(from, from + LINK_CHECK_MAX_URLS);
        const results = await checkSourceLinks(supabase, batch);
        await saveSourceChecks(supabase, results);
        done += batch.length;
        setProgress({ done, total: urls.length });
      }
      if (!stopped()) setNotice(`Checked ${String(urls.length)} links.`);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : String(cause)} ${done > 0 ? `The ${String(done)} links checked before this are saved.` : 'Nothing was saved.'}`);
    } finally {
      try {
        const nextChecks = await listSourceChecks(supabase);
        setChecks(nextChecks);
        setFlagged(await listFlaggedSourceLinks(supabase, nextChecks));
      } catch (cause) {
        setError((previous) => `${previous} ${cause instanceof Error ? cause.message : String(cause)}`.trim());
      }
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <section className={styles.panel} aria-label="Source links" data-testid="source-links">
      <div className={styles.panelHeader}>
        <div>
          <h2>Source links</h2>
          {loading ? <p>Loading…</p> : loadError !== '' ? (
            <p role="alert" className={styles.error}>{loadError}</p>
          ) : (
            <p data-testid="source-links-summary">
              {urls.length === 0 ? 'No claims have a source link yet.'
                : summary.latest === null ? `No links have been checked yet. ${String(urls.length)} to check.`
                  : `${String(summary.checked)} of ${String(urls.length)} links checked. Last check ${formatDay(summary.latest.checkedAt)}${summary.latest.checkedByName === null ? '' : ` by ${summary.latest.checkedByName}`}.`}
            </p>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { void run(); }} disabled={loading || loadError !== '' || running || urls.length === 0}>Check source links</button>
          {running && <button type="button" onClick={() => { stopRequested.current = true; }}>Stop</button>}
        </div>
      </div>
      {progress !== null && <p role="status">Checked {String(progress.done)} of {String(progress.total)}</p>}
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {!loading && loadError === '' && summary.latest !== null && flagged.length === 0 && <p>Every checked link works.</p>}
      {flagged.length > 0 && (
        <div data-testid="source-links-flagged">
          <h3>Source links to look at ({flagged.length})</h3>
          {flagged.map((item) => (
            <div key={item.check.url} className={styles.queueClaim}>
              <p><strong>{sourceCheckLabel(item.check.result)}</strong>: <a href={item.check.url} target="_blank" rel="noopener noreferrer">{item.check.url}</a></p>
              <small>{sourceCheckSentence(item.check)}</small>
              {item.claims.map((claim) => (
                <small key={`${claim.productId}-${String(claim.position)}`}>
                  <Link to={`/platform-admin/catalogue/products/${claim.productId}`}>{claim.productName}</Link> ({claim.vendor}): {claim.statement}
                </small>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
