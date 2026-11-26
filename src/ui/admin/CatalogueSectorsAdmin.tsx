import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CatalogueVersionSummary } from '../../contracts/catalogueAdmin';
import { listCatalogueVersions } from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import { currentCatalogueVersion, sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

/**
 * `/platform-admin/catalogue/sectors` — every sector's catalogue standing:
 * its current published version and how many versions exist. Read-only history: products are maintained under Products.
 */
export function CatalogueSectorsAdmin() {
  const [versions, setVersions] = useState<CatalogueVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void listCatalogueVersions(supabase)
      .then(setVersions)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const sectors = useMemo(
    () => [...new Set(versions.map((version) => version.sector))].sort((left, right) => sectorLabel(left).localeCompare(sectorLabel(right))),
    [versions],
  );

  if (loading) return <Loading />;

  return (
    <div className={styles.page} data-testid="catalogue-sectors-admin">
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {sectors.length === 0 && <p>No sector catalogues have been created yet.</p>}
      <div className={styles.productList} aria-label="Sector catalogues">
        {sectors.map((sector) => {
          const current = currentCatalogueVersion(versions, sector);
          const sectorVersions = versions.filter((version) => version.sector === sector).length;
          return (
            <Link key={sector} to={`/platform-admin/catalogue/sectors/${sector}`} className={styles.productRow}>
              <span>
                <strong>{sectorLabel(sector)}</strong>{' '}
                <small>{current ? `${current.title} · v${String(current.version)}` : 'No current published catalogue'}</small>
              </span>
              <span>{sectorVersions} {sectorVersions === 1 ? 'version' : 'versions'}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
