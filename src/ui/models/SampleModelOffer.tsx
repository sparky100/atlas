import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useSampleModels } from './useSampleModels';

export interface SampleModelOfferProps {
  orgId: UUID;
  orgSlug: string;
  userId: UUID | null;
  /** Slugs already used in this organisation, so the copy's address is unique. */
  existingSlugs: readonly string[];
}

/**
 * Shown on an organisation's empty model list (ADR-033): copy a made-up sample
 * landscape into this organisation, or ignore it and create an empty model.
 * Renders nothing when no sample has been published. The copy is a separate
 * model in this organisation only; editing or deleting it touches nothing else.
 */
export function SampleModelOffer({ orgId, orgSlug, userId, existingSlugs }: SampleModelOfferProps) {
  const navigate = useNavigate();
  const { samples, loading, copyingId, error, copy } = useSampleModels(orgId, userId, true);
  if (loading) return null;
  if (samples.length === 0) {
    return (
      <Panel>
        <Text as="p" tone="muted" size="sm">
          No sample models are available yet. Create an empty model below to start, then import a spreadsheet from Import.
        </Text>
      </Panel>
    );
  }

  return (
    <Panel>
      <Text as="h2" size="lg">
        Look around first
      </Text>
      <Text as="p" tone="muted" size="sm">
        See what Atlas shows: which applications support each capability, and how the applications connect to one another. These are made-up organisations. Adding one puts a separate copy in your organisation that you can change or delete. Nobody else sees it.
      </Text>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
        {samples.map((sample) => (
          <li key={sample.id} style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <Text as="span" size="lg">
              {sample.name}
            </Text>
            {sample.description !== null && (
              <Text as="span" tone="muted" size="sm">
                {sample.description}
              </Text>
            )}
            <div>
              <Button
                variant="primary"
                disabled={copyingId !== null}
                onClick={() => {
                  void copy(sample, existingSlugs).then((model) => {
                    if (model) void navigate(`/o/${orgSlug}/m/${model.slug}/capability-map`);
                  });
                }}
              >
                {copyingId === sample.id ? 'Adding…' : 'Add this sample'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error !== null && <Text as="p">{error}</Text>}
    </Panel>
  );
}
