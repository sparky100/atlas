import { Text } from '../components/Text/Text';
import { CANNOT_SEE_LINE, type SupporterReading } from './estateUncertainty';

/**
 * Under a starting point: what the model records about the system, what it does not,
 * and a warning tag when the match should be checked. A warning, never a block.
 */
export function EstateReading({ reading }: { reading: SupporterReading | null }) {
  if (reading === null) {
    return (
      <div data-testid="estate-reading">
        <Text as="p" size="xs" tone="muted">
          Nothing we run is checked for this option; it is a judgement.
        </Text>
      </div>
    );
  }
  return (
    <div data-testid="estate-reading">
      {reading.check && (
        <div data-testid="estate-check-tag">
          <Text as="p" size="xs">
            <strong>Check before relying on this.</strong>
          </Text>
        </div>
      )}
      {reading.known.length > 0 && (
        <Text as="p" size="xs" tone="muted">
          Recorded: {reading.known.join('; ')}.
        </Text>
      )}
      {reading.notRecorded.length > 0 && (
        <Text as="p" size="xs" tone="muted">
          Not recorded: {reading.notRecorded.join('; ')}.
        </Text>
      )}
      <Text as="p" size="xs" tone="muted">
        {CANNOT_SEE_LINE}
      </Text>
    </div>
  );
}
