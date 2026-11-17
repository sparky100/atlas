import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { refQueryParam } from '../../db/ref';
import { useSelectedRef } from '../branches/useSelectedRef';
import { Text } from '../components/Text/Text';
import { usePortfolio } from '../portfolio/usePortfolio';
import { sumCompleteness } from './gaps';

/** Home's My work: how many key facts are missing across the model, linking to Gaps. Same rows and rule as the Gaps page, so the two always agree. */
export function MissingFactsStat({ modelId, mainCommitIdHint, orgSlug, modelSlug, className }: { modelId: UUID; mainCommitIdHint: UUID | null; orgSlug: string; modelSlug: string; className?: string | undefined }) {
  const { ref } = useSelectedRef();
  const { state } = usePortfolio(modelId, ref, mainCommitIdHint, { inlineErrors: true });
  const total = state.status === 'ready' ? sumCompleteness(state.data.rows.filter((row) => row.lifecycleState === 'active')) : null;
  const missing = total ? total.total - total.recorded : null;
  const refParam = refQueryParam(ref, false);
  return (
    <div className={className}>
      <Link to={`/o/${orgSlug}/m/${modelSlug}/gaps${refParam ? `?${refParam}` : ''}`}>
        <Text as="span" size="2xl">
          {missing ?? '…'}
        </Text>{' '}
        <Text as="span" tone="muted" size="sm">
          key fact{missing === 1 ? '' : 's'} missing
        </Text>
      </Link>
    </div>
  );
}
