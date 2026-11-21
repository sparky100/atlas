/**
 * D3 PR 3: "Products that can support this" on a capability page. Reads the
 * current published catalogue for the capability's own starter-map code;
 * a capability with no `templateRef` is not guessed at, it gets the honest
 * line instead. No AI switch or key is needed.
 */
import { useQuery } from '@tanstack/react-query';
import { capabilityMapMatch, listCurrentCatalogueEntriesForCapability, type CatalogueEntry } from '../../db/productCatalogue';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { catalogueAsOf, formatCatalogueDate as formatDate, sourceDomain } from './capabilityProductsText';
import styles from './CapabilityProducts.module.css';

function Entry({ entry }: { entry: CatalogueEntry }) {
  const asOf = catalogueAsOf(entry);
  return (
    <li className={styles.entry}>
      <Text as="h3" size="md">
        {entry.product} <Text as="span" size="sm" tone="muted">by {entry.vendor}</Text>
      </Text>
      <Text as="p">{entry.summary}</Text>
      <Text as="p" size="sm" tone="muted">{entry.howItSupports}</Text>
      {asOf !== null && <Text as="p" size="sm" tone="muted">As of {formatDate(asOf)}</Text>}
      <details className={styles.claims}>
        <summary>Claims and sources ({entry.claims.length})</summary>
        <ul>
          {entry.claims.map((claim, i) => (
            <li key={`${claim.sourceUrl}-${String(i)}`}>
              <Text as="p" size="sm">{claim.statement}</Text>
              <Text as="p" size="xs" tone="muted">
                {sourceDomain(claim.sourceUrl)} · read {formatDate(claim.sourceDate)} · checked by {claim.reviewedBy} on {formatDate(claim.reviewedAt)}
              </Text>
            </li>
          ))}
        </ul>
      </details>
      <Text as="p" size="xs" tone="muted">Check with the vendor before relying on it.</Text>
    </li>
  );
}

export function CapabilityProducts({ templateRef, title = 'Products that can support this' }: { templateRef: string | null; title?: string }) {
  const match = useQuery({
    queryKey: ['capabilityCatalogueMatch', templateRef],
    enabled: templateRef !== null,
    queryFn: () => (templateRef === null ? null : capabilityMapMatch(supabase, templateRef)),
  });
  const entries = useQuery({
    queryKey: ['capabilityCatalogueEntries', match.data?.sector ?? '', match.data?.capabilityCode ?? ''],
    enabled: match.data !== null && match.data !== undefined,
    queryFn: () => (match.data ? listCurrentCatalogueEntriesForCapability(supabase, { sector: match.data.sector, capabilityCode: match.data.capabilityCode }) : Promise.resolve([])),
  });

  if (templateRef === null) {
    return (
      <Text as="p" size="sm" tone="muted">
        Product suggestions are available for capabilities created from a starter map.
      </Text>
    );
  }
  if (entries.data === undefined || entries.data.length === 0) return null;
  return (
    <Panel data-testid="capability-products">
      <CollapsibleSection title={title} defaultOpen>
        <Text as="p" size="sm" tone="muted">
          Reviewed products from the published catalogue, for a replacement or build option. They are candidates, not a procurement decision.
        </Text>
        <ul className={styles.list}>
          {entries.data.map((entry) => <Entry key={entry.id} entry={entry} />)}
        </ul>
      </CollapsibleSection>
    </Panel>
  );
}
