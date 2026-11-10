import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { CapabilityTileData } from '../../db/modelHome';
import { Chip, type ChipTone } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { Text } from '../components/Text/Text';
import { attributesRecord } from '../elements/attributesRecord';
import { decisionPrefillToSearchParams, prefillFromWeakStage } from '../decisions/decisionPrefill';
import { StartDecisionLink } from '../decisions/StartDecisionLink';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import type { MemberRole } from '../../db/types';
import { canStartDecision } from '../orgs/useMembership';
import { valueStreamInspectorEnablingCapabilities, valueStreamInspectorParentStream } from './valueStreamInspectorSelection';
import { stageToneLabel, VALUE_STREAM_TONE_LABEL, type ValueStreamStageRollup, type ValueStreamTone } from './valueStreamRollup';
import styles from './ValueStreamInspectorContent.module.css';

const TONE_CHIP: Record<ValueStreamTone, ChipTone> = { ok: 'ok', warn: 'warn', info: 'info', neutral: 'neutral' };

/**
 * V2b's shared Inspector pattern (`CapabilityMapPage.tsx`'s own precedent),
 * applied to the Value streams page (F6/ADR-023): tapping a stage tile
 * shows its enabling capabilities, each with the same tone the tile itself
 * is coloured by, and their own supporting systems — "tap a weak stage,
 * see the capability and the system" (the sprint's own golden path). No
 * "Filters"/"Actions" sections here (this view has no colour-by mode or
 * reorder toggle of its own) — just Selection.
 */
export interface ValueStreamInspectorContentProps {
  selectedStage: ValueStreamStageRollup | null;
  valueStreamsById: ReadonlyMap<UUID, ElementsHeadRow>;
  tilesByCapabilityId: ReadonlyMap<UUID, CapabilityTileData>;
  elementHref: (elementId: UUID) => string;
  decisionsHref: string;
  role: MemberRole | null;
}

export function ValueStreamInspectorContent({ selectedStage, valueStreamsById, tilesByCapabilityId, elementHref, decisionsHref, role }: ValueStreamInspectorContentProps) {
  const parentStream = selectedStage ? valueStreamInspectorParentStream(selectedStage.stage, valueStreamsById) : null;
  const enablingCapabilities = selectedStage ? valueStreamInspectorEnablingCapabilities(selectedStage, tilesByCapabilityId) : [];

  const stageDescription = selectedStage ? attributesRecord(selectedStage.stage.attributes).description : undefined;

  const startDecisionHref =
    selectedStage && canStartDecision(role)
      ? `${decisionsHref}?${decisionPrefillToSearchParams(prefillFromWeakStage({ id: selectedStage.stage.element_id, name: selectedStage.stage.name }, stageToneLabel(selectedStage.tone, selectedStage.enablingCapabilityIds.length))).toString()}`
      : null;

  return (
    <CollapsibleSection title="Selection">
      {selectedStage ? (
        <div className={styles.selection}>
          <Text as="p" size="sm" tone="muted">
            {parentStream ? parentStream.name : 'Value stream'} › {selectedStage.stage.name}
          </Text>
          {typeof stageDescription === 'string' && stageDescription.trim() !== '' && (
            <Text as="p" size="sm">
              {stageDescription}
            </Text>
          )}
          <div className={styles.attributeRow}>
            <Text as="span" size="sm" tone="muted">
              Status
            </Text>
            {stageToneLabel(selectedStage.tone, selectedStage.enablingCapabilityIds.length) !== '' && <Chip tone={TONE_CHIP[selectedStage.tone]}>{stageToneLabel(selectedStage.tone, selectedStage.enablingCapabilityIds.length)}</Chip>}
          </div>
          {selectedStage.fitForPurpose !== null && (
            <div className={styles.attributeRow}>
              <Text as="span" size="sm" tone="muted">
                Fit for purpose
              </Text>
              <Chip tone="neutral">{selectedStage.fitForPurpose}</Chip>
            </div>
          )}

          <div className={styles.subsection}>
            <Text as="h3" size="sm" tone="muted">
              Enabling capabilities
            </Text>
            {enablingCapabilities.length === 0 ? (
              <Text as="p" size="sm" tone="muted">
                No capability enables this stage.
              </Text>
            ) : (
              <ul className={styles.list}>
                {enablingCapabilities.map(({ tile }) => (
                  <li key={tile.capability.element_id}>
                    <div className={styles.attributeRow}>
                      <Link to={elementHref(tile.capability.element_id)}>{tile.capability.name}</Link>
                      {VALUE_STREAM_TONE_LABEL[tile.tone] !== '' && <Chip tone={TONE_CHIP[tile.tone]}>{VALUE_STREAM_TONE_LABEL[tile.tone]}</Chip>}
                    </div>
                    {tile.supportingSystems.length > 0 && (
                      <ul className={styles.systemList}>
                        {tile.supportingSystems.map((system) => {
                          const lifecycleStatus = attributesRecord(system.attributes).lifecycleStatus;
                          return (
                            <li key={system.element_id}>
                              <Link to={elementHref(system.element_id)}>
                                <Text as="span" size="sm">
                                  {system.name}
                                </Text>
                              </Link>{' '}
                              {typeof lifecycleStatus === 'string' && <Chip tone={lifecycleToneFor(lifecycleStatus) ?? 'neutral'}>{lifecycleStatus}</Chip>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {startDecisionHref && (
            <div className={styles.subsection}>
              <StartDecisionLink href={startDecisionHref} />
            </div>
          )}

          <div className={styles.subsection}>
            <Link to={elementHref(selectedStage.stage.element_id)}>Open stage →</Link>
          </div>
        </div>
      ) : (
        <Text as="p" size="sm" tone="muted">
          Nothing inspected. Tap a stage to inspect it.
        </Text>
      )}
    </CollapsibleSection>
  );
}
