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
  if (loading || samples.length === 0) return null;

  return (
    <Panel>
      <Text as="h2" size="lg">
        Start with a sample model
      </Text>
      <Text as="p" tone="muted" size="sm">
        Want to look around before adding your own systems? These are made-up organisations, with systems, owners, capabilities and how they connect. Adding one puts a separate copy in your organisation that you can change or delete. Nobody else sees it. Or create an empty model below.
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
                    if (model) void navigate(`/o/${orgSlug}/m/${model.slug}/start`);
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
