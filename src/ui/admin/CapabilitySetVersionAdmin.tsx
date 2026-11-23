import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { CapabilityMapContent } from '../../contracts/capabilityMapContent';
import {
  createReferenceMapDraft,
  listReferenceMaps,
  readReferenceMap,
  type ReferenceMapDraft,
  type ReferenceMapSummary,
} from '../../db/referenceMapAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { CapabilitySetPreview } from './CapabilitySetPreview';
import { contentForNewDraft } from './referenceMapDraft';
import styles from './CapabilitySetAdmin.module.css';

const BASE = '/platform-admin/capability-sets';

/**
 * `/platform-admin/capability-sets/versions/:mapId` — one fixed version,
 * read-only. The current published version can seed the next draft; an
 * earlier version stays inspectable but never starts one.
 */
export function CapabilitySetVersionAdmin({ mapId }: { mapId: string }) {
  const navigate = useNavigate();
  const [map, setMap] = useState<ReferenceMapSummary | null>(null);
  const [content, setContent] = useState<CapabilityMapContent | null>(null);
  const [maps, setMaps] = useState<ReferenceMapSummary[]>([]);
  const [drafts, setDrafts] = useState<ReferenceMapDraft[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const result = await listReferenceMaps(supabase);
        const found = result.maps.find((candidate) => candidate.id === mapId) ?? null;
        if (!found) throw new Error('This capability set version could not be found.');
        const loaded = await readReferenceMap(supabase, found);
        setMaps(result.maps);
        setDrafts(result.drafts);
        setMap(found);
        setContent(loaded);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [mapId]);

  const sectorMaps = map === null ? [] : maps.filter((candidate) => candidate.sector === map.sector).sort((a, b) => b.version - a.version);
  const current = sectorMaps.find((candidate) => candidate.status === 'published') ?? null;
  const isCurrent = map !== null && current?.id === map.id;
  const hasDraft = map !== null && drafts.some((draft) => draft.sector === map.sector && draft.status === 'draft');

  const start = () => {
    if (map === null || hasDraft) return;
    setBusy(true); setError('');
    void (async () => {
      try {
        const nextVersion = Math.max(
          0,
          ...maps.filter((candidate) => candidate.sector === map.sector).map((candidate) => candidate.version),
          ...drafts.filter((draft) => draft.sector === map.sector).map((draft) => draft.version),
        ) + 1;
        const initial = await contentForNewDraft(map.sector, nextVersion, map);
        const id = await createReferenceMapDraft(supabase, map.sector, nextVersion, map.id, initial);
        void navigate(`${BASE}/drafts/${id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading) return <Loading />;
  if (loadError !== '' || map === null || content === null) {
    return (
      <div className={styles.page}>
        <Link to={BASE} className={styles.backLink}>← Capability sets</Link>
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This capability set version could not be loaded.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="capability-set-version">
      <Link to={BASE} className={styles.backLink}>← Capability sets</Link>
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      <div>
        <Text as="h1" size="2xl">
          {content.title !== '' ? content.title : map.sector}
        </Text>
        <Text as="p" tone="muted" size="sm">
          {map.sector.replaceAll('_', ' ')} · v{map.version} · {map.status}
          {' · '}
          {content.items.length} capabilities · {content.valueStreams.length} value streams · {map.seeded_model_count} seeded models
          {map.published_at ? ` · published ${new Date(map.published_at).toLocaleDateString('en-GB')}` : ''}
        </Text>
      </div>

      {isCurrent ? (
        <div className={styles.actions}>
          <button type="button" onClick={start} disabled={busy || hasDraft}>
            {busy ? 'Creating…' : 'Create draft from current'}
          </button>
          {hasDraft && <span>There is already an open draft for this sector. Open it from Capability sets.</span>}
        </div>
      ) : (
        <p>This is an earlier version. The next draft starts from the current published version.</p>
      )}

      <section className={styles.preview} aria-label="Capability set contents">
        <CapabilitySetPreview
          content={content}
          code={code}
          onSelectCode={setCode}
          filter={filter}
          onFilterChange={setFilter}
          footer={(
            <p className={styles.previewFoot}>
              {isCurrent
                ? 'This is the version used when creating the next draft for this sector.'
                : 'This earlier version is available to inspect. The next draft starts from the current published version.'}
              {' '}Viewing a set does not change it or any seeded model.
            </p>
          )}
        />
      </section>
    </div>
  );
}
