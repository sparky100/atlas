import { Link } from 'react-router';
import { Text } from '../components/Text/Text';

export interface StartDecisionLinkProps {
  /** The full `/decisions?...` href, prefill params already attached (`decisionPrefillToSearchParams`) — this component only renders the link, it never builds the params itself. */
  href: string;
}

/**
 * Prompt pack F3 PR6's "Start a decision" affordance — one small link,
 * reused by both named entry points (`ArchitectHome.tsx`'s health-finding
 * row action, `DirectorHome.tsx`'s weak-capability tile) rather than each
 * building its own. Always navigates to `/decisions` with the click's own
 * context pre-filled into the creation form there — this component itself
 * writes nothing.
 */
export function StartDecisionLink({ href }: StartDecisionLinkProps) {
  return (
    <Link to={href}>
      <Text as="span" size="sm">
        Start a decision →
      </Text>
    </Link>
  );
}
