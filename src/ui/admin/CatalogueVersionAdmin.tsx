import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CatalogueVersionSummary } from '../../contracts/catalogueAdmin';
import { listCatalogueEntries, listCatalogueVersions, type CatalogueEntryDetail } from '../../db/catalogueAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { sectorLabel } from './catalogueShared';
import styles from './CatalogueAdmin.module.css';
import { errorText } from './adminErrorText';

const BASE = '/platform-admin/catalogue';

/**
 * `/platform-admin/catalogue/sectors/:sector/versions/:catalogueId` — one
 * published (or withdrawn) catalogue version, read-only. This renders what a
 * catalogue reader gets: product, vendor, summary, capabilities and claims
 * with their source and dates. Reviewer metadata is deliberately absent.
 */
export function CatalogueVersionAdmin({ catalogueId, sector }: { catalogueId: string; sector: string }) {
  const [version, setVersion] = useState<CatalogueVersionSummary | null>(null);
  const [entries, setEntries] = useState<CatalogueEntryDetail[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const nextVersions = await listCatalogueVersions(supabase);
        const found = nextVersions.find((candidate) => candidate.id === catalogueId) ?? null;
        if (!found) throw new Error('This catalogue version could not be found.');
        setVersion(found);
        setEntries(await listCatalogueEntries(supabase, catalogueId));
      } catch (cause) {
        setLoadError(errorText(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [catalogueId]);

  if (loading) return <Loading />;

  return (
    <div className={styles.page} data-testid="catalogue-version-admin">
      <Link to={`${BASE}/sectors/${sector}`} className={styles.backLink}>← {sectorLabel(sector)}</Link>
      {loadError !== '' || version === null ? (
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This catalogue version could not be loaded.'}</p>
      ) : (
        <>
          <div>
            <Text as="h1" size="2xl">{version.title}</Text>
            <Text as="p" tone="muted" size="sm">
              {sectorLabel(version.sector)} · v{version.version} · pinned capability set v{version.capability_map_version}
              {' · '}{version.status}
              {version.published_at ? ` · published ${new Date(version.published_at).toLocaleDateString('en-GB')}` : ''}
              {' · '}{entries.length} products
            </Text>
            {version.withdrawn_at && (
              <Text as="p" tone="muted" size="sm">
                Withdrawn {new Date(version.withdrawn_at).toLocaleDateString('en-GB')}: {version.withdrawn_reason}
              </Text>
            )}
          </div>
          {entries.length === 0 && <p>No entries are visible in this version.</p>}
          {entries.map((entry) => (
            <details className={styles.itemCard} key={entry.id}>
              <summary>{entry.product} · {entry.vendor} <small>{entry.code}</small></summary>
              <p>{entry.summary}</p>
              <h2>Capabilities in this set</h2>
              <ul>
                {entry.capabilities.map((capability) => (
                  <li key={capability.code}><strong>{capability.name}</strong> <small>{capability.code}</small> · {capability.howItSupports}</li>
                ))}
              </ul>
              <h2>Claims</h2>
              <ul>
                {entry.claims.map((claim, index) => (
                  <li key={index}>
                    {claim.statement}{' '}
                    <small>
                      {claim.kind} · <a href={claim.sourceUrl} target="_blank" rel="noreferrer">source</a> dated {claim.sourceDate}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
