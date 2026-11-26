import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CatalogueProductSummary } from '../../contracts/catalogueAdmin';
import { listCatalogueProducts } from '../../db/catalogueAdmin';
import { LinkButton } from '../components/Button/LinkButton';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import styles from './CatalogueAdmin.module.css';

/**
 * `/platform-admin/catalogue` — the product library list. Editing is on the
 * product's own route; this page only searches and links.
 */
export function CatalogueProductsAdmin() {
  const [products, setProducts] = useState<CatalogueProductSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void listCatalogueProducts(supabase)
      .then(setProducts)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return products;
    return products.filter((product) => `${product.product} ${product.vendor} ${product.code}`.toLowerCase().includes(term));
  }, [products, search]);

  const waiting = products.reduce((sum, product) => sum + product.claimsWaitingForReview, 0);

  if (loading) return <Loading />;

  return (
    <div className={styles.page} data-testid="catalogue-products-admin">
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.controls}>
        <label>Find a product <input value={search} onChange={(event) => { setSearch(event.target.value); }} placeholder="Name, vendor or code" /></label>
        <span>{String(filtered.length)} shown</span>
        <LinkButton variant="secondary" to="/platform-admin/catalogue/products/new">New product</LinkButton>
      </div>
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
            </span>
            <span>
              {product.capabilitySetCount} capability sets · {product.capabilityCount} links · {product.claimCount} claims{product.claimsWaitingForReview > 0 ? ` (${String(product.claimsWaitingForReview)} to review)` : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
