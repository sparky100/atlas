import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ClaimWaitingForReview } from '../../contracts/catalogueAdmin';
import { listClaimsWaitingForReview, REVIEW_QUEUE_PAGE, reviewProductClaims } from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import { CatalogueClaimChecks } from './CatalogueClaimChecks';
import { CatalogueFindProducts } from './CatalogueFindProducts';
import { CatalogueSetProducts } from './CatalogueSetProducts';
import { CatalogueMonthlyCheck } from './CatalogueMonthlyCheck';
import { CatalogueSourceLinks } from './CatalogueSourceLinks';
import { claimDraftedText } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

interface ProductGroup {
  productId: string;
  productName: string;
  vendor: string;
  claims: ClaimWaitingForReview[];
}

/**
 * `/platform-admin/catalogue/review` — every product claim that has been
 * drafted (typed by a person, loaded from a file, or later found by the
 * Researcher) and not yet reviewed. Anyone with admin rights can review. The
 * server records who and when; this screen only says which claims.
 */
export function CatalogueReviewQueue() {
  const [claims, setClaims] = useState<ClaimWaitingForReview[]>([]);
  const [total, setTotal] = useState(0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [runsVersion, setRunsVersion] = useState(0);
  const recordRun = useCallback(() => { setRunsVersion((version) => version + 1); }, []);

  const reload = useCallback(async () => {
    const result = await listClaimsWaitingForReview(supabase);
    setClaims(result.claims);
    setTotal(result.total);
    setChosen(new Set());
  }, []);

  useEffect(() => {
    void listClaimsWaitingForReview(supabase)
      .then((result) => { setClaims(result.claims); setTotal(result.total); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const groups = useMemo(() => {
    const byProduct = new Map<string, ProductGroup>();
    for (const claim of claims) {
      const group = byProduct.get(claim.productId) ?? { productId: claim.productId, productName: claim.productName, vendor: claim.vendor, claims: [] };
      group.claims.push(claim);
      byProduct.set(claim.productId, group);
    }
    return [...byProduct.values()];
  }, [claims]);

  const toggle = (claimId: string, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(claimId); else next.delete(claimId);
      return next;
    });
  };

  const review = async (group: ProductGroup, claimIds: string[]) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const count = await reviewProductClaims(supabase, group.productId, claimIds);
      await reload();
      setNotice(count === 0
        ? `Nothing changed for ${group.productName}: those claims were already reviewed or edited.`
        : `${String(count)} claim${count === 1 ? '' : 's'} for ${group.productName} marked as reviewed by you.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await reload().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className={styles.page} data-testid="catalogue-review-queue">
      <CatalogueMonthlyCheck refreshKey={runsVersion} />
      <CatalogueSourceLinks onRunRecorded={recordRun} />
      <CatalogueClaimChecks onRunRecorded={recordRun} />
      <CatalogueFindProducts onRunRecorded={() => { recordRun(); void reload().catch(() => undefined); }} />
      <CatalogueSetProducts onRunRecorded={recordRun} onChanged={() => { void reload().catch(() => undefined); }} />
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}
      {error === '' && claims.length === 0 && <p>Nothing is waiting for review. Every claim in the product library has been reviewed.</p>}
      {total > REVIEW_QUEUE_PAGE && <p role="status">Showing the first {String(REVIEW_QUEUE_PAGE)} of {String(total)} claims waiting. Review these and the rest will appear.</p>}
      <div className={styles.queue}>
        {groups.map((group) => {
          const picked = group.claims.filter((claim) => chosen.has(claim.claimId)).map((claim) => claim.claimId);
          return (
            <section key={group.productId} className={styles.queueProduct} aria-label={group.productName}>
              <header>
                <h2>{group.productName} <small>{group.vendor}</small></h2>
                <Link to={`/platform-admin/catalogue/products/${group.productId}`}>Open product</Link>
              </header>
              {group.claims.map((claim) => (
                <div key={claim.claimId} className={styles.queueClaim}>
                  <label className={styles.checkLine}>
                    <input type="checkbox" checked={chosen.has(claim.claimId)} onChange={(event) => { toggle(claim.claimId, event.target.checked); }} disabled={busy} />
                    <span>
                      <strong>{claim.kind.replaceAll('_', ' ')}</strong>: {claim.statement}
                    </span>
                  </label>
                  <small>
                    <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">Open the source</a> · source dated {claim.sourceDate} · {claimDraftedText(claim.origin, claim.draftedByName, claim.draftedAt)}
                  </small>
                </div>
              ))}
              <div className={styles.actions}>
                <button type="button" disabled={busy || picked.length === 0} onClick={() => { void review(group, picked); }}>
                  Mark {String(picked.length)} selected as reviewed by me
                </button>
                <button type="button" disabled={busy} onClick={() => { void review(group, group.claims.map((claim) => claim.claimId)); }}>
                  Mark all {String(group.claims.length)} as reviewed by me
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
