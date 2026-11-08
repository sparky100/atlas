import { Link } from 'react-router';
import { EmptyState } from './EmptyState';

export interface ModelEmptyStateProps {
  orgSlug: string;
  modelSlug: string;
}

/** What every model page shows when the model has no content on this ref yet: say so plainly and point at the one way to start, instead of a bare "Nothing here yet." */
export function ModelEmptyState({ orgSlug, modelSlug }: ModelEmptyStateProps) {
  return (
    <EmptyState>
      This model has nothing in it yet. <Link to={`/o/${orgSlug}/m/${modelSlug}/capture`}>Import a file to get started →</Link>
    </EmptyState>
  );
}
