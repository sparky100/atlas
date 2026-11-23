import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CatalogueDraftRow, CatalogueVersionSummary } from '../../contracts/catalogueAdmin';
import { listCatalogueDrafts, listCatalogueVersions } from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import { currentCatalogueVersion, sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

/**
 * `/platform-admin/catalogue/sectors` — every sector's catalogue standing:
 * its current published version, how many versions exist and any open draft.
 */
export function CatalogueSectorsAdmin() {
  const [versions, setVersions] = useState<CatalogueVersionSummary[]>([]);
  const [drafts, setDrafts] = useState<CatalogueDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([listCatalogueVersions(supabase), listCatalogueDrafts(supabase)])
      .then(([nextVersions, nextDrafts]) => {
        setVersions(nextVersions);
        setDrafts(nextDrafts);
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  const sectors = useMemo(
    () => [...new Set([...versions.map((version) => version.sector), ...drafts.map((draft) => draft.sector)])].sort((left, right) => sectorLabel(left).localeCompare(sectorLabel(right))),
    [versions, drafts],
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
          const openDrafts = drafts.filter((draft) => draft.sector === sector && draft.status === 'draft').length;
          return (
            <Link key={sector} to={`/platform-admin/catalogue/sectors/${sector}`} className={styles.productRow}>
              <span>
                <strong>{sectorLabel(sector)}</strong>{' '}
                <small>{current ? `${current.title} · v${String(current.version)}` : 'No current published catalogue'}</small>
              </span>
              <span>
                {sectorVersions} versions · {openDrafts === 0 ? 'no open drafts' : `${String(openDrafts)} open ${openDrafts === 1 ? 'draft' : 'drafts'}`}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
