import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { SECTORS } from '../../contracts/capabilityMapContent';
import {
  createReferenceMapDraft,
  listReferenceMaps,
  type ReferenceMapDraft,
  type ReferenceMapSummary,
} from '../../db/referenceMapAdmin';
import { Loading } from '../components/Loading/Loading';
import { supabase } from '../supabaseClient';
import { contentForNewDraft } from './referenceMapDraft';
import styles from './CapabilitySetAdmin.module.css';

const BASE = '/platform-admin/capability-sets';

/**
 * `/platform-admin/capability-sets` — the list half of the capability-set
 * editor: one sector at a time, its published versions and its drafts. Every
 * action navigates to a route; nothing is edited here.
 */
export function CapabilitySetsAdmin() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<ReferenceMapSummary[]>([]);
  const [drafts, setDrafts] = useState<ReferenceMapDraft[]>([]);
  const [sector, setSector] = useState<string>(SECTORS[0]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const result = await listReferenceMaps(supabase);
    setMaps(result.maps);
    setDrafts(result.drafts);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh sets state only after its awaited reads.
    void refresh()
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, [refresh]);

  const sectorMaps = maps.filter((map) => map.sector === sector).sort((a, b) => b.version - a.version);
  const current = sectorMaps.find((map) => map.status === 'published') ?? null;
  const sectorDrafts = drafts.filter((draft) => draft.sector === sector && draft.status === 'draft');
  const nextVersion = Math.max(
    0,
    ...maps.filter((map) => map.sector === sector).map((map) => map.version),
    ...drafts.filter((draft) => draft.sector === sector).map((draft) => draft.version),
  ) + 1;

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const start = () => void run(async () => {
    const base = current;
    const content = await contentForNewDraft(sector, nextVersion, base);
    const id = await createReferenceMapDraft(supabase, sector, nextVersion, base?.id ?? null, content);
    void navigate(`${BASE}/drafts/${id}`);
  });

  return (
    <div className={styles.page} data-testid="capability-sets-admin">
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.controls}>
        <label>
          Sector{' '}
          <select value={sector} onChange={(event) => { setSector(event.target.value); }} disabled={busy}>
            {SECTORS.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <span>{current ? `Current: ${current.title ?? current.sector} v${String(current.version)}` : 'No published map'}</span>
        {current && (
          <button type="button" onClick={() => { void navigate(`${BASE}/versions/${current.id}`); }} disabled={busy}>
            View current set
          </button>
        )}
        <button type="button" onClick={start} disabled={busy || sectorDrafts.length > 0}>
          Create v{nextVersion} draft{current ? ' from current' : ''}
        </button>
      </div>

      {loading ? <Loading /> : (
        <>
          <details open>
            <summary>Versions for {sector.replaceAll('_', ' ')} ({sectorMaps.length})</summary>
            <div className={styles.cards}>
              {sectorMaps.map((map) => (
                <div className={styles.itemCard} key={map.id}>
                  <strong>{map.title ?? map.sector} · v{map.version}</strong>
                  <span>{current?.id === map.id ? 'Current published version' : map.status}</span>
                  <span>{map.item_count} capabilities · {map.seeded_model_count} models seeded</span>
                  <span>{map.published_at ? `Published ${new Date(map.published_at).toLocaleDateString('en-GB')}` : 'Not published'}</span>
                  <button type="button" onClick={() => { void navigate(`${BASE}/versions/${map.id}`); }} disabled={busy}>
                    View v{map.version} contents
                  </button>
                </div>
              ))}
              {sectorMaps.length === 0 && <p>This sector has no published or earlier versions yet.</p>}
            </div>
          </details>

          <h2 className={styles.subheading}>Drafts</h2>
          {sectorDrafts.length === 0 ? (
            <p>No open drafts for this sector.</p>
          ) : (
            <div className={styles.draftList} aria-label="Capability set drafts">
              {sectorDrafts.map((entry) => (
                <button type="button" key={entry.id} disabled={busy} onClick={() => { void navigate(`${BASE}/drafts/${entry.id}`); }}>
                  {entry.content.title || entry.sector} · v{entry.version}{' '}
                  <small>Edited {new Date(entry.updated_at).toLocaleDateString('en-GB')}</small>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
