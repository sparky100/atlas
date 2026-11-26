import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { claimCheckKey, claimCheckVerdictLabel, type ClaimCheckRow, type ClaimForCheck, type SourceCheckRow } from '../../contracts/catalogueAdmin';
import { checkClaims, dismissClaimCheck, listClaimChecks, listClaimsForCheck, listSourceChecks, saveClaimChecks } from '../../db/catalogueAdmin';
import { CLAIM_CHECK_MAX_CLAIMS } from '../../tools/catalogueClaimCheck';
import { supabase } from '../supabaseClient';
import { formatDay } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

/**
 * The "Claims" section of Waiting for review (step 5b-1). It asks the claim
 * checker, a few claims at a time, whether each cited page still says what the
 * claim says, saves what comes back as it goes, and lists every claim that
 * changed or could not be told, so a person can fix it or keep it. The AI only
 * flags: it never edits a claim or unpublishes anything, and every result says
 * it was checked by the AI.
 */
export function CatalogueClaimChecks() {
  const [claims, setClaims] = useState<ClaimForCheck[]>([]);
  const [checks, setChecks] = useState<ClaimCheckRow[]>([]);
  const [linkChecks, setLinkChecks] = useState<SourceCheckRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [running, setRunning] = useState(false);
  const [checkAgain, setCheckAgain] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const stopped = () => stopRequested.current;

  useEffect(() => {
    void (async () => {
      try {
        const [nextClaims, nextChecks, nextLinks] = await Promise.all([listClaimsForCheck(supabase), listClaimChecks(supabase), listSourceChecks(supabase)]);
        setClaims(nextClaims);
        setChecks(nextChecks);
        setLinkChecks(nextLinks);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const view = useMemo(() => {
    const byKey = new Map(checks.map((check) => [claimCheckKey(check), check]));
    const goneLinks = new Set(linkChecks.filter((check) => check.result === 'gone').map((check) => check.url));
    const current = claims.map((claim) => ({ claim, check: byKey.get(claimCheckKey(claim)) }));
    const checked = current.filter((item) => item.check !== undefined);
    const latest = checked.reduce<ClaimCheckRow | null>((best, item) => (item.check !== undefined && (best === null || item.check.checkedAt > best.checkedAt) ? item.check : best), null);
    const due = current.filter((item) => !goneLinks.has(item.claim.sourceUrl) && (checkAgain || item.check === undefined)).map((item) => item.claim);
    const toLookAt = checked
      .flatMap((item) => (item.check !== undefined && item.check.verdict !== 'supported' && item.check.dismissedAt === null ? [{ claim: item.claim, check: item.check }] : []))
      .sort((a, b) => b.check.checkedAt.localeCompare(a.check.checkedAt));
    return { checked: checked.length, latest, due, toLookAt };
  }, [claims, checks, linkChecks, checkAgain]);

  const reload = async () => {
    setChecks(await listClaimChecks(supabase));
  };

  const run = async () => {
    stopRequested.current = false;
    setRunning(true); setError(''); setNotice('');
    const queue = view.due;
    let done = 0;
    setProgress({ done, total: queue.length });
    try {
      for (let from = 0; from < queue.length; from += CLAIM_CHECK_MAX_CLAIMS) {
        if (stopped()) { setNotice(`Stopped after ${String(done)} of ${String(queue.length)} claims. The results so far are saved.`); break; }
        const batch = queue.slice(from, from + CLAIM_CHECK_MAX_CLAIMS);
        const results = await checkClaims(supabase, batch);
        await saveClaimChecks(supabase, results);
        done += batch.length;
        setProgress({ done, total: queue.length });
      }
      if (!stopped()) setNotice(`Checked ${String(queue.length)} claims.`);
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : String(cause)} ${done > 0 ? `The ${String(done)} claims checked before this are saved.` : 'Nothing was saved.'}`);
    } finally {
      try { await reload(); } catch (cause) { setError((previous) => `${previous} ${cause instanceof Error ? cause.message : String(cause)}`.trim()); }
      setRunning(false);
      setProgress(null);
    }
  };

  const clear = async (check: ClaimCheckRow) => {
    setClearing(claimCheckKey(check)); setError(''); setNotice('');
    try {
      await dismissClaimCheck(supabase, check);
      await reload();
      setNotice('Recorded: you looked and the claim stands.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await reload().catch(() => undefined);
    } finally {
      setClearing(null);
    }
  };

  return (
    <section className={styles.panel} aria-label="Claim checks" data-testid="claim-checks">
      <div className={styles.panelHeader}>
        <div>
          <h2>Claims against their sources</h2>
          {loading ? <p>Loading…</p> : loadError !== '' ? (
            <p role="alert" className={styles.error}>{loadError}</p>
          ) : (
            <p data-testid="claim-checks-summary">
              {claims.length === 0 ? 'No claims yet.'
                : view.latest === null ? `No claims have been checked against their sources yet. ${String(claims.length)} to check.`
                  : `${String(view.checked)} of ${String(claims.length)} claims checked. Last check ${formatDay(view.latest.checkedAt)}${view.latest.checkedByName === null ? '' : ` by ${view.latest.checkedByName}`}, read by the AI${view.latest.model === null ? '' : ` (${view.latest.model})`}.`}
            </p>
          )}
          <label className={styles.checkLine}>
            <input type="checkbox" checked={checkAgain} onChange={(event) => { setCheckAgain(event.target.checked); }} disabled={running} /> Check again the claims already checked
          </label>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { void run(); }} disabled={loading || loadError !== '' || running || view.due.length === 0}>
            Check claims against their sources{view.due.length > 0 ? ` (${String(view.due.length)})` : ''}
          </button>
          {running && <button type="button" onClick={() => { stopRequested.current = true; }}>Stop</button>}
        </div>
      </div>
      {progress !== null && <p role="status">Checked {String(progress.done)} of {String(progress.total)}</p>}
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {!loading && loadError === '' && view.latest !== null && view.toLookAt.length === 0 && <p>Every checked claim still matches its source, or has been looked at.</p>}
      {view.toLookAt.length > 0 && (
        <div data-testid="claim-checks-flagged">
          <h3>Claims to look at ({view.toLookAt.length})</h3>
          {view.toLookAt.map(({ claim, check }) => (
            <div key={claimCheckKey(check)} className={styles.queueClaim}>
              <p>
                <strong>{claimCheckVerdictLabel(check.verdict)}</strong>: {claim.statement}
              </p>
              <small>
                <Link to={`/platform-admin/catalogue/products/${claim.productId}`}>{claim.product}</Link> ({claim.vendor}) · <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">open the source</a>
              </small>
              {check.quote !== null && <small data-testid="claim-check-quote">The page says: “{check.quote}”</small>}
              {check.note !== null && <small>{check.note}</small>}
              <small>Checked by the AI{check.model === null ? '' : ` (${check.model})`}, {formatDay(check.checkedAt)}. Not checked by a person.</small>
              <div className={styles.actions}>
                <button type="button" onClick={() => { void clear(check); }} disabled={clearing !== null || running}>I looked: it still stands</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
