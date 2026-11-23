import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SECTORS, type Sector } from '../../contracts/capabilityMapContent';
import type { CapabilitySetOption, CatalogueDraftContent, CatalogueDraftRow, CatalogueVersionSummary } from '../../contracts/catalogueAdmin';
import {
  createCatalogueDraft,
  listCapabilitySets,
  listCatalogueDrafts,
  listCatalogueProductIds,
  listCatalogueVersions,
  withdrawCatalogue,
} from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { currentCatalogueVersion, sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';

const BASE = '/platform-admin/catalogue';

/**
 * `/platform-admin/catalogue/sectors/:sector` — one sector's published
 * versions, open draft and withdraw action. Editing a draft happens on the
 * draft's own route.
 */
export function CatalogueSectorAdmin({ sector }: { sector: string }) {
  const navigate = useNavigate();
  const validSector = (SECTORS as readonly string[]).includes(sector);
  const [versions, setVersions] = useState<CatalogueVersionSummary[]>([]);
  const [drafts, setDrafts] = useState<CatalogueDraftRow[]>([]);
  const [sets, setSets] = useState<CapabilitySetOption[]>([]);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(validSector);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextVersions, nextDrafts] = await Promise.all([listCatalogueVersions(supabase), listCatalogueDrafts(supabase)]);
    setVersions(nextVersions);
    setDrafts(nextDrafts);
  }, []);

  useEffect(() => {
    if (!validSector) return;
    void (async () => {
      try {
        const [nextVersions, nextDrafts, nextSets] = await Promise.all([
          listCatalogueVersions(supabase),
          listCatalogueDrafts(supabase),
          listCapabilitySets(supabase),
        ]);
        setVersions(nextVersions);
        setDrafts(nextDrafts);
        setSets(nextSets);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [validSector]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const sectorVersions = versions.filter((version) => version.sector === sector).sort((a, b) => b.version - a.version);
  const current = currentCatalogueVersion(versions, sector);
  const sectorDrafts = drafts.filter((draft) => draft.sector === sector && draft.status === 'draft');
  const sectorSets = sets.filter((set) => set.sector === sector).sort((a, b) => b.version - a.version);
  const nextVersion = Math.max(
    0,
    ...versions.filter((version) => version.sector === sector).map((version) => version.version),
    ...drafts.filter((draft) => draft.sector === sector).map((draft) => draft.version),
  ) + 1;

  const createDraft = () => void run(async () => {
    const base = current;
    const baseProducts = base === null ? [] : await listCatalogueProductIds(supabase, base.id);
    const map = sectorSets.find((set) => set.status === 'published') ?? sectorSets[0];
    if (!map) throw new Error('Create a capability set for this sector first.');
    const content: CatalogueDraftContent = {
      sector: sector as Sector,
      version: nextVersion,
      capabilityMapVersion: map.version,
      title: `${sectorLabel(sector)} product catalogue, version ${String(nextVersion)}`,
      sourceDescription: base === null
        ? 'Platform-reviewed product catalogue.'
        : `Products selected from ${base.title}, version ${String(base.version)}.`,
      productIds: baseProducts,
    };
    const id = await createCatalogueDraft(supabase, sector, nextVersion, base?.id ?? null, content);
    void navigate(`${BASE}/sectors/${sector}/drafts/${id}`);
  });

  const withdraw = () => void run(async () => {
    if (current === null || withdrawReason.trim() === '') return;
    await withdrawCatalogue(supabase, current.id, withdrawReason.trim());
    await refresh();
    setWithdrawReason('');
    setNotice(`Withdrew ${sectorLabel(current.sector)} v${String(current.version)}.`);
  });

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

  return (
    <div className={styles.page} data-testid="catalogue-sector-admin">
      <Link to={`${BASE}/sectors`} className={styles.backLink}>← Sector catalogues</Link>
      <div>
        <Text as="h1" size="2xl">{sectorLabel(sector)}</Text>
        <Text as="p" tone="muted" size="sm">
          {current ? `Current: ${current.title} v${String(current.version)} · published ${current.published_at ? new Date(current.published_at).toLocaleDateString('en-GB') : 'not published'}` : 'No current published catalogue'}
        </Text>
      </div>
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}

      <div className={styles.actions}>
        {current && (
          <Link to={`${BASE}/sectors/${sector}/versions/${current.id}`}>View current products</Link>
        )}
        <button type="button" onClick={createDraft} disabled={busy || sectorDrafts.length > 0 || sectorSets.length === 0}>
          Create v{nextVersion} draft{current ? ' from current' : ''}
        </button>
        {sectorDrafts.length > 0 && <span>An open draft already exists. Open it below.</span>}
        {sectorSets.length === 0 && <span>Create a capability set for this sector before a catalogue draft.</span>}
      </div>

      {current?.withdrawn_at === null && (
        <div className={styles.withdraw}>
          <label>Withdrawal reason <input value={withdrawReason} onChange={(event) => { setWithdrawReason(event.target.value); }} placeholder="Why this version is no longer current" /></label>
          <button type="button" onClick={withdraw} disabled={busy || withdrawReason.trim() === ''}>Withdraw current version</button>
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

      <h2>Drafts</h2>
      {sectorDrafts.length === 0 ? (
        <p>No open drafts for this sector.</p>
      ) : (
        <div className={styles.draftList} aria-label="Catalogue drafts">
          {sectorDrafts.map((draft) => (
            <button type="button" className={styles.draftButton} key={draft.id} onClick={() => { void navigate(`${BASE}/sectors/${sector}/drafts/${draft.id}`); }}>
              {draft.content.title} · v{draft.version} <small>Edited {new Date(draft.updated_at).toLocaleDateString('en-GB')}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
