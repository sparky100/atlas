import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CatalogueProductSummary } from '../../contracts/catalogueAdmin';
import { addPlatform, listCatalogueProducts } from '../../db/catalogueAdmin';
import { LinkButton } from '../components/Button/LinkButton';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import { publicationLabelText } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

/**
 * `/platform-admin/catalogue` — the product library list. Editing is on the
 * product's own route; this page only searches and links.
 */
export function CatalogueProductsAdmin() {
  const [products, setProducts] = useState<CatalogueProductSummary[]>([]);
  const [search, setSearch] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [platformName, setPlatformName] = useState('');
  const [platformVendor, setPlatformVendor] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void listCatalogueProducts(supabase)
      .then(setProducts)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = readyOnly
      ? products.filter((product) => product.claimCount > 0 && product.claimsWaitingForReview === 0 && (product.capabilityCount + product.sharedCapabilityCount > 0 || product.componentCount > 0) && product.publication !== 'published')
      : products;
    if (term === '') return base;
    return base.filter((product) => `${product.product} ${product.vendor} ${product.code}`.toLowerCase().includes(term));
  }, [products, search, readyOnly]);

  const nameById = useMemo(() => new Map(products.map((product) => [product.id, product.product])), [products]);
  const waiting = products.reduce((sum, product) => sum + product.claimsWaitingForReview, 0);

  if (loading) return <Loading />;

  return (
    <div className={styles.page} data-testid="catalogue-products-admin">
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.controls}>
        <label>Find a product <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Name, vendor or code" /></label>
        <label className={styles.checkLine}><input type="checkbox" checked={readyOnly} onChange={(event) => { setReadyOnly(event.target.checked); }} /> Ready to publish</label>
        <span>{String(filtered.length)} shown</span>
        <LinkButton variant="secondary" to="/platform-admin/catalogue/products/new">New product</LinkButton>
      </div>
      <details className={styles.section} data-testid="add-platform">
        <summary>
          <span className={styles.sectionTitle}>Add a platform</span>
          <span className={styles.sectionHint}>Enter its name and vendor. It is added as a draft and the Researcher then searches for its components.</span>
        </summary>
        <form className={styles.sectionBody} onSubmit={(event) => {
          event.preventDefault();
          setAdding(true); setError('');
          void addPlatform(supabase, platformVendor, platformName)
            // A platform already in the library is opened, not copied (rule I1), and its search starts there.
            .then((result) => navigate(`/platform-admin/catalogue/products/${result.platformId}`, { state: { findComponents: true } }))
            .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
            .finally(() => { setAdding(false); });
        }}>
          <label>Platform name <input value={platformName} onChange={(event) => { setPlatformName(event.target.value); }} placeholder="SAP S/4HANA Utilities" /></label>
          <label>Vendor <input value={platformVendor} onChange={(event) => { setPlatformVendor(event.target.value); }} placeholder="SAP" /></label>
          <button type="submit" disabled={adding || platformName.trim() === '' || platformVendor.trim() === ''}>{adding ? 'Adding…' : 'Add platform and find its components'}</button>
        </form>
      </details>
      {waiting > 0 && (
        <p role="status">
          {String(waiting)} claim{waiting === 1 ? ' is' : 's are'} waiting for review. <Link to="/platform-admin/catalogue/review">Review them</Link>
        </p>
      )}
      {products.length === 0 && <p>No products in the library yet.</p>}
      {products.length > 0 && filtered.length === 0 && <p>No products match.</p>}
      <div className={styles.productList} aria-label="Products">
        {filtered.map((product) => (
          <Link key={product.id} to={`/platform-admin/catalogue/products/${product.id}`} className={styles.productRow}>
            <span>
              <strong>{product.product}</strong>{' '}
              <small>{product.vendor} · {product.code}</small>
              {product.componentCount > 0 && <small data-testid="platform-tag"> · platform with {String(product.componentCount)} component{product.componentCount === 1 ? '' : 's'}</small>}
              {product.partOfProductId !== null && <small data-testid="component-tag"> · part of {nameById.get(product.partOfProductId) ?? 'a platform'}</small>}
            </span>
            <span>
              {publicationLabelText(product.publication)} · {product.capabilitySetCount} capability sets · {product.capabilityCount + product.sharedCapabilityCount} links · {product.claimCount} claims{product.claimsWaitingForReview > 0 ? ` (${String(product.claimsWaitingForReview)} to review)` : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
