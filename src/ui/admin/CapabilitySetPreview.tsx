import type { ReactNode } from 'react';
import type { CapabilityMapContent } from '../../contracts/capabilityMapContent';
import { treeOrder } from './capabilitySetTree';
import styles from './CapabilitySetAdmin.module.css';

export interface CapabilitySetPreviewProps {
  content: CapabilityMapContent;
  /** The selected capability code, or null before anything is selected. */
  code: string | null;
  onSelectCode: (code: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  /** Status note and actions for this version, rendered after the sources. */
  footer?: ReactNode;
}

/**
 * The one read-only view of a capability set: searchable tree, selected
 * definition, value streams and sources. Used by the published-version page,
 * so what an admin inspects is exactly what the content holds.
 */
export function CapabilitySetPreview({ content, code, onSelectCode, filter, onFilterChange, footer }: CapabilitySetPreviewProps) {
  const selected = code === null ? undefined : content.items.find((item) => item.code === code);
  const parent = selected ? content.items.find((item) => item.code === selected.parentCode) : undefined;
  const matches = treeOrder(content.items).filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      {content.summary !== '' && <p>{content.summary}</p>}
      <div className={styles.previewGrid}>
        <div className={styles.tree}>
          <label>
            Find in this set{' '}
            <input
              value={filter}
              onChange={(event) => { onFilterChange(event.target.value); }}
              placeholder="Capability name or code"
            />
          </label>
          <div className={styles.scroll} role="group" aria-label="Capabilities in this set">
            {matches.map((item) => (
              <button
                type="button"
                key={item.code}
                className={code === item.code ? styles.active : ''}
                style={{ paddingLeft: `${String(8 + (item.level - 1) * 14)}px` }}
                onClick={() => { onSelectCode(item.code); }}
              >
                {item.name} <small>{item.code} · level {item.level}</small>
              </button>
            ))}
            {filter !== '' && matches.length === 0 && <p>No matching capabilities.</p>}
          </div>
        </div>
        <div className={styles.itemCard}>
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <p>{parent ? `Under ${parent.name}` : 'Top level'} · {selected.code}</p>
              <p>{selected.description?.trim() ? selected.description : 'No definition recorded.'}</p>
            </>
          ) : (
            <p>Select a capability to read its definition and place in the set.</p>
          )}
        </div>
      </div>
      <details>
        <summary>Value streams ({content.valueStreams.length})</summary>
        <div className={styles.cards}>
          {[...content.valueStreams].sort((a, b) => a.order - b.order).map((stream) => (
            <details className={styles.itemCard} key={stream.code}>
              <summary>{stream.name} · {stream.stages.length} stages</summary>
              {stream.description !== '' && <p>{stream.description}</p>}
              <ol>
                {[...stream.stages].sort((a, b) => a.order - b.order).map((stage) => (
                  <li key={stage.code}>
                    <strong>{stage.name}</strong>
                    {stage.description !== '' && <p>{stage.description}</p>}
                    <small>Enabled by: {stage.enables.join(', ') || 'No capabilities recorded'}</small>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </div>
        {content.valueStreams.length === 0 && <p>No value streams recorded in this version.</p>}
      </details>
      <details>
        <summary>Sources ({content.sources.length}) and origin</summary>
        <p>{content.sourceDescription !== '' ? content.sourceDescription : 'No origin recorded.'}</p>
        <ul>
          {content.sources.map((source, index) => (
            <li key={index}>
              {source.url !== '' ? <a href={source.url} target="_blank" rel="noreferrer">{source.citation}</a> : source.citation}
              {' · reviewed '}{source.reviewedAt}
            </li>
          ))}
        </ul>
      </details>
      {footer}
    </>
  );
}
