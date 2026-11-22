import type { OptionCatalogueSource, OptionSource } from '../../contracts/optionSource';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import styles from './OptionSources.module.css';

function standingText(source: OptionCatalogueSource): string {
  switch (source.standing) {
    case 'current':
      return `current in catalogue v${String(source.version)}`;
    case 'replaced':
      return `saved from catalogue v${String(source.version)}, which has since been replaced`;
    case 'withdrawn':
      return `saved from catalogue v${String(source.version)}, now withdrawn`;
  }
}

/**
 * The evidence saved with an option when it was added. It is deliberately
 * quiet and collapsed: the option's own words come first, and a reader who
 * wants to check where they came from can open this. The standing line is
 * live; everything else is the saved citation, never re-read from the
 * catalogue as if it were current. A web page is shown as unreviewed and
 * never carries a reviewer line.
 */
export function OptionSources({ sources }: { sources: readonly OptionSource[] }) {
  if (sources.length === 0) return null;
  const hasWeb = sources.some((source) => source.kind === 'web');
  return (
    <div data-testid="option-sources" className={styles.block}>
      <CollapsibleSection title="Sources" meta={`(${String(sources.length)})`} defaultOpen={false}>
        <Text as="p" size="xs" tone="muted">
          Saved when this option was added. Candidates, not a recommendation.
        </Text>
        {hasWeb && (
          <Text as="p" size="xs" tone="muted">
            Catalogue claims are reviewed; web pages are not. A checked web page shows what the person said it supports.
          </Text>
        )}
        <ul className={styles.list}>
          {sources.map((source) => (
            <li key={source.id} className={styles.source}>
              {source.kind === 'catalogue' ? (
                <>
                  <Text as="p" size="sm">
                    {source.product} — {source.vendor}
                  </Text>
                  <Text as="p" size="xs" tone="muted">
                    {standingText(source)}
                  </Text>
                  <ul className={styles.claims}>
                    {source.claims.map((claim) => (
                      <li key={String(claim.position)}>
                        <a href={claim.sourceUrl} target="_blank" rel="noreferrer">
                          {claim.statement}
                        </a>
                        <Text as="span" size="xs" tone="muted">
                          {' '}
                          — source dated {claim.sourceDate}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    <Text as="p" size="sm">
                      {source.title}
                    </Text>
                  </a>
                  <Text as="p" size="xs" tone="muted">
                    {source.publisher ?? 'Web page'} · retrieved {source.retrievedAt.slice(0, 10)}
                    {source.checkedAt !== null ? ` · checked by a person on ${source.checkedAt.slice(0, 10)}` : ' · not checked'}
                  </Text>
                  {source.excerpt !== null && (
                    <Text as="p" size="sm" tone="muted">
                      {source.excerpt}
                    </Text>
                  )}
                  {source.assertion !== null && (
                    <Text as="p" size="sm">
                      Supports: {source.assertion}
                    </Text>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}
