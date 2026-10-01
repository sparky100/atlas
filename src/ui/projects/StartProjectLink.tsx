import { Link } from 'react-router';
import { Text } from '../components/Text/Text';

/**
 * F10 step 7 (ADR-024 §6.4): "Start a project →", the sibling of
 * `StartDecisionLink` — `href` is a `/projects?…` link carrying the same
 * prefill params (`decisionPrefillToSearchParams`) the project form reads.
 */
export function StartProjectLink({ href }: { href: string }) {
  return (
    <Link to={href}>
      <Text as="span" size="sm">
        Start a project →
      </Text>
    </Link>
  );
}
