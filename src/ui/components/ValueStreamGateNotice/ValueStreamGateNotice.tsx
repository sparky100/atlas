import { Link } from 'react-router';
import { Text } from '../Text/Text';

export interface ValueStreamGateNoticeProps {
  orgSlug: string;
  modelSlug: string;
}

/**
 * ADR-023/F6 Decision 1's own message: value streams change on `main`, or
 * inside a `correct`-intent change — never inside a `propose`/`record`/
 * `explore` one. Shown wherever a structural affordance
 * (`canEditValueStreamStructure`, `src/ui/orgs/roleGates.ts`) would
 * otherwise render but the currently-selected ref doesn't pass that gate,
 * so the person sees *why* the control is missing rather than a plain
 * absence.
 */
export function ValueStreamGateNotice({ orgSlug, modelSlug }: ValueStreamGateNoticeProps) {
  return (
    <Text as="p" tone="muted" size="sm">
      Value streams change on main or in a correction. Open a correct-intent{' '}
      <Link to={`/o/${orgSlug}/m/${modelSlug}/changes`}>change</Link> to edit this.
    </Text>
  );
}
