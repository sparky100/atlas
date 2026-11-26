import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { SECTORS } from '../../contracts/capabilityMapContent';
import type { CatalogueVersionSummary } from '../../contracts/catalogueAdmin';
import {
  listCatalogueEntries,
  listCatalogueVersions,
  listPublishedProductNames,
  withdrawCatalogue,
} from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { currentCatalogueVersion, entriesNotYetPublished, sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

const BASE = '/platform-admin/catalogue';

interface SectorState {
  versions: CatalogueVersionSummary[];
  /** Products of the current version that no published product matches; `null` when that could not be checked (withdrawal stays blocked). */
  onlyHere: string[] | null;
  checkError: string;
}

async function readSectorState(sector: string): Promise<SectorState> {
  const versions = await listCatalogueVersions(supabase);
  const current = currentCatalogueVersion(versions, sector);
  if (current === null) return { versions, onlyHere: [], checkError: '' };
  try {
    const [entries, published] = await Promise.all([listCatalogueEntries(supabase, current.id), listPublishedProductNames(supabase)]);
    return { versions, onlyHere: entriesNotYetPublished(entries, published).map((entry) => entry.product), checkError: '' };
  } catch (cause) {
    return { versions, onlyHere: null, checkError: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * `/platform-admin/catalogue/sectors/:sector` — one sector's catalogue
 * history, read-only, and the one action left: withdrawing the current
 * version. Withdrawing is blocked while any of its products is not yet
 * published as a product, because users would lose it (step 4b-3).
 */
export function CatalogueSectorAdmin({ sector }: { sector: string }) {
  const validSector = (SECTORS as readonly string[]).includes(sector);
  const [versions, setVersions] = useState<CatalogueVersionSummary[]>([]);
  const [onlyHere, setOnlyHere] = useState<string[] | null>(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checkError, setCheckError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(validSector);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((state: SectorState) => {
    setVersions(state.versions);
    setOnlyHere(state.onlyHere);
    setCheckError(state.checkError);
  }, []);

  useEffect(() => {
    if (!validSector) return;
    void readSectorState(sector)
      .then(apply)
      .catch((cause: unknown) => { setLoadError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, [validSector, sector, apply]);

  const sectorVersions = versions.filter((version) => version.sector === sector).sort((a, b) => b.version - a.version);
  const current = currentCatalogueVersion(versions, sector);

  const withdraw = () => {
    if (current === null || withdrawReason.trim() === '' || onlyHere === null || onlyHere.length > 0) return;
    setBusy(true); setError(''); setNotice('');
    void (async () => {
      try {
        await withdrawCatalogue(supabase, current.id, withdrawReason.trim());
        setWithdrawReason('');
        apply(await readSectorState(sector));
        setNotice(`Withdrew ${sectorLabel(current.sector)} v${String(current.version)}.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!validSector) {
    return (
      <div className={styles.page}>
        <Link to={`${BASE}/sectors`} className={styles.backLink}>← Sector catalogues</Link>
        <p role="alert" className={styles.error}>This sector does not exist.</p>
      </div>
    );
  }
  if (loading) return <Loading />;
  if (loadError !== '') {
    return (
      <div className={styles.page}>
        <Link to={`${BASE}/sectors`} className={styles.backLink}>← Sector catalogues</Link>
        <p role="alert" className={styles.error}>{loadError}</p>
      </div>
    );
  }

  const blocked = onlyHere === null || onlyHere.length > 0;

  return (
    <div className={styles.page} data-testid="catalogue-sector-admin">
      <Link to={`${BASE}/sectors`} className={styles.backLink}>← Sector catalogues</Link>
      <div>
        <Text as="h1" size="2xl">{sectorLabel(sector)}</Text>
        <Text as="p" tone="muted" size="sm">
          {current ? `Current: ${current.title} v${String(current.version)} · published ${current.published_at ? new Date(current.published_at).toLocaleDateString('en-GB') : 'not published'}` : 'No current published catalogue'}
        </Text>
        <Text as="p" tone="muted" size="sm">Read-only history. Products are maintained and published one at a time under <Link to={BASE}>Products</Link>.</Text>
      </div>
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}

      {current && (
        <div className={styles.actions}>
          <Link to={`${BASE}/sectors/${sector}/versions/${current.id}`}>View current products</Link>
        </div>
      )}

      {current && (
        <div className={styles.withdraw} data-testid="sector-withdraw">
          {checkError !== '' && <p role="alert" className={styles.error}>Could not check which products are published: {checkError}</p>}
          {onlyHere !== null && onlyHere.length > 0 && (
            <p data-testid="sector-withdraw-blocked">
              {onlyHere.length} of this catalogue&rsquo;s products {onlyHere.length === 1 ? 'is' : 'are'} not yet published as {onlyHere.length === 1 ? 'a product' : 'products'}, so users would lose {onlyHere.length === 1 ? 'it' : 'them'} if it were withdrawn: {onlyHere.join(', ')}. Publish {onlyHere.length === 1 ? 'it' : 'them'} under Products first.
            </p>
          )}
          {onlyHere !== null && onlyHere.length === 0 && <p>Every product in this catalogue is published as a product, so it can be withdrawn without users losing any.</p>}
          <label>Withdrawal reason <input value={withdrawReason} onChange={(event) => { setWithdrawReason(event.target.value); }} placeholder="Why this version is no longer current" /></label>
          <button type="button" onClick={withdraw} disabled={busy || blocked || withdrawReason.trim() === ''}>Withdraw current version</button>
        </div>
      )}

      <details open>
        <summary>Versions for {sectorLabel(sector)} ({sectorVersions.length})</summary>
        <div className={styles.cards}>
          {sectorVersions.map((version) => (
            <div className={styles.itemCard} key={version.id}>
              <strong>{version.title} · v{version.version}</strong>
              <span>{version.status === 'published' ? 'Published' : version.status} · capability set v{version.capability_map_version}</span>
              <span>{version.published_at ? `Published ${new Date(version.published_at).toLocaleDateString('en-GB')}` : 'Not published'}</span>
              {version.withdrawn_at && <span>Withdrawn {new Date(version.withdrawn_at).toLocaleDateString('en-GB')}: {version.withdrawn_reason}</span>}
              <Link to={`${BASE}/sectors/${sector}/versions/${version.id}`}>View products</Link>
            </div>
          ))}
          {sectorVersions.length === 0 && <p>No versions yet.</p>}
        </div>
      </details>
    </div>
  );
}
