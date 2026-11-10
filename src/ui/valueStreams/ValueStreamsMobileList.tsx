import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UUID } from '../../contracts/delta';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import type { ValueStreamRow } from './useValueStreams';
import { stageToneLabel, VALUE_STREAM_TONE_LABEL, type ValueStreamStageRollup } from './valueStreamRollup';
import styles from './ValueStreamsMobileList.module.css';

export interface ValueStreamsMobileListProps {
  rows: readonly ValueStreamRow[];
  selectedStageId: UUID | null;
  onSelectStage: (stageId: UUID) => void;
  /** The tapped stage's own detail — the same `ValueStreamInspectorContent` the desktop Inspector renders, shown inline under its row instead of in a side panel (the same "shared inspector content, inline vs. panel" split `LandscapeMobileList.tsx`/`LandscapeInspectorContent.tsx` already establish). */
  renderStageDetail: (stage: ValueStreamStageRollup) => ReactNode;
}

/**
 * The mobile (<768px) Value streams list (F6/ADR-023): streams as an
 * accordion (one open at a time — same shape `LandscapeMobileList.tsx`'s
 * own `expandedKey` already uses), stages as rows within. Tapping a stage
 * row shows its own inspector content inline, right below it, rather than
 * a side panel there's no room for on a narrow viewport.
 */
export function ValueStreamsMobileList({ rows, selectedStageId, onSelectStage, renderStageDetail }: ValueStreamsMobileListProps) {
  const [expandedStreamId, setExpandedStreamId] = useState<UUID | null>(null);
  const active = rows.filter((row) => !row.inactive);
  const inactive = rows.filter((row) => row.inactive);

  if (rows.length === 0) {
    return (
      <Text as="p" tone="muted">
        No value streams recorded yet.
      </Text>
    );
  }

  function renderRow(row: ValueStreamRow) {
    return (
      <CollapsibleSection
        key={row.stream.element_id}
        title={row.stream.name}
        meta={
          <span className={styles.factIndicator}>
            <span className={styles.factDot} data-tone={row.rollup.tone} aria-hidden="true" />
            {VALUE_STREAM_TONE_LABEL[row.rollup.tone] !== '' && (
              <Text as="span" size="xs" tone="muted">{VALUE_STREAM_TONE_LABEL[row.rollup.tone]}</Text>
            )}
          </span>
        }
        open={expandedStreamId === row.stream.element_id}
        onOpenChange={(open) => {
          setExpandedStreamId(open ? row.stream.element_id : null);
        }}
      >
        <ul className={styles.rows}>
          {row.stages.length === 0 && (
            <li>
              <Text as="span" size="sm" tone="muted">
                No stages recorded.
              </Text>
            </li>
          )}
          {row.stages.map((stage) => (
            <li key={stage.stage.element_id}>
              <button
                type="button"
                className={styles.stageRow}
                onClick={() => {
                  onSelectStage(stage.stage.element_id);
                }}
              >
                <span className={styles.factDot} data-tone={stage.tone} aria-hidden="true" />
                <Text as="span" size="sm">
                  {stage.stage.name}
                </Text>
                {stageToneLabel(stage.tone, stage.enablingCapabilityIds.length) !== '' && (
                  <Text as="span" size="xs" tone="muted">{stageToneLabel(stage.tone, stage.enablingCapabilityIds.length)}</Text>
                )}
              </button>
              {selectedStageId === stage.stage.element_id && <div className={styles.detail}>{renderStageDetail(stage)}</div>}
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    );
  }

  return (
    <div className={styles.list}>
      {active.map(renderRow)}
      {inactive.length > 0 && (
        <CollapsibleSection title={`Inactive (${String(inactive.length)})`} defaultOpen={false}>
          <div className={styles.list}>{inactive.map(renderRow)}</div>
        </CollapsibleSection>
      )}
    </div>
  );
}
