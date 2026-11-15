import { Text } from '../Text/Text';

/** Value streams usually have up to this many stages. A guide only: nothing blocks adding more. */
export const VALUE_STREAM_USUAL_MAX_STAGES = 6;

/** A gentle, uncoloured note shown once a value stream has more stages than is usual. */
export function ValueStreamStageNudge({ stageCount }: { stageCount: number }) {
  if (stageCount <= VALUE_STREAM_USUAL_MAX_STAGES) return null;
  return (
    <Text as="p" size="sm" tone="muted">
      Value streams usually have up to {String(VALUE_STREAM_USUAL_MAX_STAGES)} stages. Consider merging stages.
    </Text>
  );
}
