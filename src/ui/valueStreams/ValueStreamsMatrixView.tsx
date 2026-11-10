import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { CapabilityTileData } from '../../db/modelHome';
import { Text } from '../components/Text/Text';
import { buildStageMatrix } from './stageMatrix';
import type { ValueStreamRow } from './useValueStreams';
import { VALUE_STREAM_TONE_LABEL } from './valueStreamRollup';
import styles from './ValueStreamsMatrixView.module.css';

export interface ValueStreamsMatrixViewProps {
  rows: readonly ValueStreamRow[];
  tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>;
  elementHref: (id: UUID) => string;
}

/**
 * "Capabilities by stage": the cross-map BIZBOK treats as the main link
 * between the two layers. Capabilities down the side, stages across the top
 * (grouped under their stream), a tick where a capability delivers a stage.
 * A capability with a problem says so in words beside its name; the tick is
 * tinted to match, so colour is never the only signal. Stages nobody delivers
 * are listed underneath, each a link.
 */
export function ValueStreamsMatrixView({ rows, tilesByCapabilityId, elementHref }: ValueStreamsMatrixViewProps) {
  const matrix = buildStageMatrix(rows, tilesByCapabilityId);
  if (matrix.columns.length === 0) {
    return (
      <Text as="p" tone="muted">
        No stages recorded yet.
      </Text>
    );
  }
  // Group the header cells by stream so each stream name spans its own stages.
  const streams: { id: UUID; name: string; count: number }[] = [];
  for (const column of matrix.columns) {
    const last = streams[streams.length - 1];
    if (last?.id === column.streamId) last.count += 1;
    else streams.push({ id: column.streamId, name: column.streamName, count: 1 });
  }
  return (
    <div className={styles.wrapper}>
      {matrix.undeliveredStages.length > 0 && (
        <Text as="p" size="sm">
          No capability delivers:{' '}
          {matrix.undeliveredStages.map((column, index) => (
            <span key={column.stageId}>
              {index > 0 && ', '}
              <Link to={elementHref(column.stageId)}>
                {column.streamName} › {column.stageName}
              </Link>
            </span>
          ))}
        </Text>
      )}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>Capabilities by value stream stage</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner} rowSpan={2}>
                Capability
              </th>
              {streams.map((stream) => (
                <th key={stream.id} scope="colgroup" colSpan={stream.count} className={styles.streamHead}>
                  <Link to={elementHref(stream.id)}>{stream.name}</Link>
                </th>
              ))}
            </tr>
            <tr>
              {matrix.columns.map((column) => (
                <th key={column.stageId} scope="col" className={styles.stageHead}>
                  <Link to={elementHref(column.stageId)}>{column.stageName}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.capability.element_id}>
                <th scope="row" className={styles.rowHead}>
                  <Link to={elementHref(row.capability.element_id)}>{row.capability.name}</Link>
                  {VALUE_STREAM_TONE_LABEL[row.tone] !== '' && (
                    <Text as="span" size="xs" tone="muted" className={styles.rowNote}>
                      {VALUE_STREAM_TONE_LABEL[row.tone]}
                    </Text>
                  )}
                </th>
                {matrix.columns.map((column) => {
                  const delivers = row.stageIds.has(column.stageId);
                  return (
                    <td key={column.stageId} className={styles.cell} data-tone={delivers ? row.tone : undefined}>
                      {delivers && (
                        <span aria-label={`${row.capability.name} delivers ${column.stageName}`} role="img">
                          ✓
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
