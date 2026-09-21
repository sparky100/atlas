import { Link } from 'react-router';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import type { AffectedValueStream } from '../../valueStreams/impactTraversal';
import styles from './ValueStreamImpactSection.module.css';

export interface ValueStreamImpactSectionProps {
  orgSlug: string;
  modelSlug: string;
  affected: readonly AffectedValueStream[];
}

/**
 * The element page's own "Impact" section (F6/ADR-023, system/container/
 * capability pages): "affected value streams" one level deeper than
 * `ChangeView.tsx`'s own Affected-capabilities panel — a stream, its own
 * reached stages beneath it, each stage's own "via" line naming which of
 * this element's capabilities enables it.
 */
export function ValueStreamImpactSection({ orgSlug, modelSlug, affected }: ValueStreamImpactSectionProps) {
  if (affected.length === 0) return <EmptyState>No value stream reaches this element yet.</EmptyState>;

  return (
    <ul className={styles.list}>
      {affected.map(({ stream, stages }) => (
        <li key={stream.element_id}>
          <div className={styles.subjectTitle}>
            <ElementTypeGlyph type="value_stream" />
            <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stream.element_id}`}>
              <Text as="span">{stream.name}</Text>
            </Link>
          </div>
          <ul className={styles.stageList}>
            {stages.map(({ stage, viaCapabilities }) => (
              <li key={stage.element_id}>
                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${stage.element_id}`}>
                  <Text as="span" size="sm">
                    {stage.name}
                  </Text>
                </Link>
                {viaCapabilities.length > 0 && (
                  <Text as="p" tone="muted" size="sm">
                    via {viaCapabilities.map((c) => c.name).join(', ')}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
