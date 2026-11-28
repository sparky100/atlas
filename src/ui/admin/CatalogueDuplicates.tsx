import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CatalogueProductSummary, ProductMergeRow } from '../../contracts/catalogueAdmin';
import { listCatalogueProducts, listMergedProducts, mergeProducts, undoProductMerge } from '../../db/catalogueAdmin';
import { duplicateCandidates } from '../../tools/catalogueResultActions';
import { supabase } from '../supabaseClient';
import { formatDay, publicationLabelText } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

type MergedRow = ProductMergeRow & { mergedName: string; keptName: string; vendor: string };

function describe(product: CatalogueProductSummary): string {
  const links = product.capabilityCount + product.sharedCapabilityCount;
  return `${String(links)} capability link${links === 1 ? '' : 's'}, ${String(product.claimCount)} claim${product.claimCount === 1 ? '' : 's'}, ${publicationLabelText(product.publication).toLowerCase()}`;
}

/**
 * Products by the same vendor whose names are the same, or sit inside one
 * another ("Esri ArcGIS Utility Network" and "ArcGIS Utility Network"). A person
 * picks which one to keep; the other is merged into it: its links and claims
 * are added to the kept product (claims as new drafts to review) and the merge
 * is recorded with who and when. Nothing is deleted, and a merge can be undone.
 */
export function CatalogueDuplicates({ onChanged, onCount }: { onChanged?: () => void; onCount?: (count: number, hasRecord: boolean) => void } = {}) {
  const [products, setProducts] = useState<CatalogueProductSummary[]>([]);
  const [merged, setMerged] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ keepId: string; mergeId: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [nextProducts, nextMerged] = await Promise.all([listCatalogueProducts(supabase), listMergedProducts(supabase)]);
    setProducts(nextProducts);
    setMerged(nextMerged);
  }, []);

  useEffect(() => {
    void Promise.all([listCatalogueProducts(supabase), listMergedProducts(supabase)])
      .then(([nextProducts, nextMerged]) => { setProducts(nextProducts); setMerged(nextMerged); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const pairs = useMemo(() => duplicateCandidates(products), [products]);

  // The section header shows how many pairs are waiting; merged products stay reachable, so say when there is a record.
  useEffect(() => {
    if (!loading) onCount?.(pairs.length, merged.length > 0);
  }, [loading, pairs.length, merged.length, onCount]);

  const act = async (work: () => Promise<string>) => {
    setBusy(true); setError(''); setNotice('');
    try {
      setNotice(await work());
      setConfirm(null);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await load().catch(() => undefined);
      setBusy(false);
    }
  };

  const doMerge = (keepId: string, mergeId: string) => act(async () => {
    const result = await mergeProducts(supabase, keepId, mergeId, 'Same product under two names.');
    return `Merged. ${byId.get(keepId)?.product ?? 'The kept product'} gained ${String(result.addedLinks + result.addedSharedLinks)} link${result.addedLinks + result.addedSharedLinks === 1 ? '' : 's'} and ${String(result.addedClaims)} claim${result.addedClaims === 1 ? '' : 's'} (the claims are drafts for you to review). Recorded with your name.`;
  });

  if (loading) return null;
  if (error !== '' && products.length === 0) return <p role="alert" className={styles.error}>{error}</p>;
  if (pairs.length === 0 && merged.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Possible duplicates" data-testid="duplicates">
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {pairs.length === 0 && <p>No products look like the same product under two names.</p>}
      {pairs.length > 0 && (
        <div className={styles.pairList} data-testid="duplicate-pairs">
          <div className={styles.groupBody}>
            {pairs.map((pair) => {
              const a = byId.get(pair.a.id);
              const b = byId.get(pair.b.id);
              if (a === undefined || b === undefined) return null;
              const pending = confirm !== null && ((confirm.keepId === a.id && confirm.mergeId === b.id) || (confirm.keepId === b.id && confirm.mergeId === a.id)) ? confirm : null;
              return (
                <div key={`${a.id}-${b.id}`} className={styles.resultRow} data-testid="duplicate-pair">
                  <p><strong>{a.product}</strong> and <strong>{b.product}</strong> <small>({a.vendor})</small></p>
                  <small>{pair.how === 'same' ? 'The same name once the vendor’s name is left out.' : 'One name sits inside the other.'}</small>
                  <small><Link to={`/platform-admin/catalogue/products/${a.id}`}>{a.product}</Link>: {describe(a)}.</small>
                  <small><Link to={`/platform-admin/catalogue/products/${b.id}`}>{b.product}</Link>: {describe(b)}.</small>
                  {pending === null ? (
                    <div className={styles.rowActions}>
                      <button type="button" disabled={busy} onClick={() => { setConfirm({ keepId: a.id, mergeId: b.id }); }}>Keep {a.product}, merge {b.product} into it</button>
                      <button type="button" disabled={busy} onClick={() => { setConfirm({ keepId: b.id, mergeId: a.id }); }}>Keep {b.product}, merge {a.product} into it</button>
                    </div>
                  ) : (
                    <div className={styles.rowActions}>
                      <p role="status">Merge {byId.get(pending.mergeId)?.product} into {byId.get(pending.keepId)?.product}? {byId.get(pending.keepId)?.product} gets the links and claims it lacks, and the claims come in as drafts to review. {byId.get(pending.mergeId)?.product} is kept as a record and can be restored.</p>
                      <button type="button" disabled={busy} onClick={() => { void doMerge(pending.keepId, pending.mergeId); }}>Merge</button>
                      <button type="button" disabled={busy} onClick={() => { setConfirm(null); }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {merged.length > 0 && (
        <details className={styles.group} data-testid="merged-products">
          <summary>Merged products ({String(merged.length)})</summary>
          <div className={styles.groupBody}>
            {merged.map((row) => (
              <div key={row.mergedProductId} className={styles.resultRow} data-testid="merged-row">
                <p><strong>{row.mergedName}</strong> was merged into <strong>{row.keptName}</strong> <small>({row.vendor})</small></p>
                <small>{formatDay(row.mergedAt)}{row.mergedByName === null ? '' : ` by ${row.mergedByName}`}. It is kept as a record and left out of the lists.</small>
                <div className={styles.rowActions}>
                  <button type="button" disabled={busy} onClick={() => { void act(async () => { await undoProductMerge(supabase, row.mergedProductId); return `${row.mergedName} is back in the lists. What was added to ${row.keptName} stays there.`; }); }}>Undo merge</button>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
