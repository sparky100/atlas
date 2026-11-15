import { Link } from 'react-router';
import { ValueStreamStageNudge } from '../components/ValueStreamStagesSection/ValueStreamStageNudge';
import type { UUID } from '../../contracts/delta';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import type { CapabilityTileData } from '../../db/modelHome';
import type { ValueStreamRow } from './useValueStreams';
import { stageToneLabel, VALUE_STREAM_TONE_LABEL } from './valueStreamRollup';
import { attributesRecord } from '../elements/attributesRecord';
import styles from './ValueStreamsView.module.css';

export interface ValueStreamsViewProps {
  rows: readonly ValueStreamRow[];
  selectedStageId?: UUID | null;
  onInspectStage?: (stageId: UUID) => void;
  /** F6 Step 6 (director door "By outcome"): a compact, read-only rendering where a stage tile links out to its own element page instead of opening the shared Inspector. */
  compact?: boolean;
  /** Required in `compact` mode — builds each stage tile's own element-page href. */
  elementHref?: (id: UUID) => string;
  /** When given, each stage tile names the capabilities that deliver it, so the stage-to-capability link is visible without opening the inspector. */
  tilesByCapabilityId?: ReadonlyMap<UUID, CapabilityTileData>;
}

/**
 * The Value streams page's own desktop rendering (F6/ADR-023, "one row per
 * stream, stages left to right as tiles coloured by the rollup"). Tone is
 * never colour-only (§8.7): each stage tile pairs its dot with the plain
 * word `TONE_LABEL` gives it, the same `FactIndicator` shape
 * `CapabilityMapView.tsx` already established. Tapping a stage opens the
 * shared Inspector (`ValueStreamsPage.tsx` owns `selectedStageId`) rather
 * than navigating — the stage's own element page is still one click away
 * from there ("Open stage →").
 *
 * Inactive streams (`ADR-023`: deactivated, never deleted) collapse into
 * their own section rather than cluttering the primary list — same
 * "collapsed, not hidden" treatment `RelationshipsSection.tsx`'s own
 * retracted rows use elsewhere in this codebase.
 */
export function ValueStreamsView({ rows, selectedStageId, onInspectStage, compact, elementHref, tilesByCapabilityId }: ValueStreamsViewProps) {
  const active = rows.filter((row) => !row.inactive);
  const inactive = rows.filter((row) => row.inactive);

  if (rows.length === 0) {
    return (
      <Text as="p" tone="muted">
        No value streams recorded yet.
      </Text>
    );
  }

  return (
    <div className={styles.streams}>
      {active.map((row) => (
        <StreamRow key={row.stream.element_id} row={row} selectedStageId={selectedStageId} onInspectStage={onInspectStage} compact={compact} elementHref={elementHref} tilesByCapabilityId={tilesByCapabilityId} />
      ))}
      {inactive.length > 0 && (
        <CollapsibleSection title={`Inactive (${String(inactive.length)})`} defaultOpen={false}>
          <div className={styles.streams}>
            {inactive.map((row) => (
              <StreamRow key={row.stream.element_id} row={row} selectedStageId={selectedStageId} onInspectStage={onInspectStage} compact={compact} elementHref={elementHref} tilesByCapabilityId={tilesByCapabilityId} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function StreamRow({ row, selectedStageId, onInspectStage, compact, elementHref, tilesByCapabilityId }: { tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData> | undefined; row: ValueStreamRow; selectedStageId: UUID | null | undefined; onInspectStage: ((stageId: UUID) => void) | undefined; compact: boolean | undefined; elementHref: ((id: UUID) => string) | undefined }) {
  const description = attributesRecord(row.stream.attributes).description;
  return (
    <div className={styles.streamRow}>
      <div className={styles.streamHeader}>
        <Text as="h2" size="lg">
          {row.stream.name}
        </Text>
        <span className={styles.factIndicator}>
          <span className={styles.factDot} data-tone={row.rollup.tone} aria-hidden="true" />
          {VALUE_STREAM_TONE_LABEL[row.rollup.tone] !== '' && (
            <Text as="span" size="sm" tone="muted">{VALUE_STREAM_TONE_LABEL[row.rollup.tone]}</Text>
          )}
        </span>
      </div>
      {typeof description === 'string' && description.trim() !== '' && (
        <Text as="p" size="sm" tone="muted">
          {description}
        </Text>
      )}
      <ValueStreamStageNudge stageCount={row.stages.length} />
      <div className={styles.stages}>
        {row.stages.length === 0 ? (
          <Text as="p" size="sm" tone="muted">
            No stages recorded.
          </Text>
        ) : (
          row.stages.map((stage) => {
            const inner = (
              <>
                <span className={styles.factDot} data-tone={stage.tone} aria-hidden="true" />
                <Text as="span" size="sm" className={styles.stageName}>
                  {stage.stage.name}
                </Text>
                {stageToneLabel(stage.tone, stage.enablingCapabilityIds.length) !== '' && (
                  <Text as="span" size="xs" tone="muted">{stageToneLabel(stage.tone, stage.enablingCapabilityIds.length)}</Text>
                )}
                {tilesByCapabilityId && stage.enablingCapabilityIds.length > 0 && (
                  <Text as="span" size="xs" tone="muted">
                    {delivererNames(stage.enablingCapabilityIds, tilesByCapabilityId)}
                  </Text>
                )}
              </>
            );
            if (compact && elementHref) {
              return (
                <Link key={stage.stage.element_id} to={elementHref(stage.stage.element_id)} className={styles.stageTile}>
                  {inner}
                </Link>
              );
            }
            return (
              <button
                key={stage.stage.element_id}
                type="button"
                className={styles.stageTile}
                data-selected={selectedStageId === stage.stage.element_id ? 'true' : undefined}
                onClick={() => {
                  onInspectStage?.(stage.stage.element_id);
                }}
              >
                {inner}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/** "Connections, Wayleaves +2 more" — the first few capability names, so the tile stays small. */
function delivererNames(ids: readonly UUID[], tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>): string {
  const names = ids.map((id) => tilesByCapabilityId.get(id)?.capability.name).filter((name): name is string => name !== undefined);
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} +${String(names.length - 3)} more` : shown;
}
