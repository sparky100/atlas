import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Text } from '../components/Text/Text';
import { usePrincipleDepartures } from './usePrincipleDepartures';

/** The homes' one-line count of decisions that depart from a principle, linking to the Principles page. Shown only when there is at least one: a plain number, never a score. */
export function PrincipleDeparturesNote({ modelId, principlesHref }: { modelId: UUID; principlesHref: string }) {
  const count = usePrincipleDepartures(modelId);
  if (count === null || count === 0) return null;
  return (
    <Text as="p" size="sm">
      {count === 1 ? '1 decision departs' : `${String(count)} decisions depart`} from a principle. <Link to={principlesHref}>See which on Principles →</Link>
    </Text>
  );
}
