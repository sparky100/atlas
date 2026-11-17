import { Link } from 'react-router';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { completenessLabel, missingFactsText, type Completeness } from './gaps';

export interface CompletenessChipProps {
  completeness: Completeness;
  /** Opens the Fill in walk on this element's missing facts; omitted when nothing can be walked (or the viewer can't fill in). */
  fillInHref?: string | undefined;
  /** What the count covers, e.g. "supporting systems" for a capability. */
  scope?: string | undefined;
}

/**
 * "4 of 6 recorded": a plain count of key facts filled in — never a score,
 * never coloured (a half-complete element is not a fault). Says what is
 * missing in words next to it.
 */
export function CompletenessChip({ completeness, fillInHref, scope }: CompletenessChipProps) {
  if (completeness.total === 0) return null;
  const missing = missingFactsText(completeness);
  const chip = <Chip>{completenessLabel(completeness)}</Chip>;
  return (
    <>
      {fillInHref ? <Link to={fillInHref} aria-label={`${completenessLabel(completeness)}${scope ? ` across ${scope}` : ''}. Fill in what is missing`}>{chip}</Link> : chip}
      {(missing !== '' || scope) && (
        <Text as="span" tone="muted" size="sm">
          {scope ? `${scope}. ` : ''}
          {missing !== '' ? `Missing: ${missing}` : ''}
        </Text>
      )}
    </>
  );
}
