import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useSyncDescriptions } from './useSyncDescriptions';
import type { UUID } from '../../contracts/delta';

export interface SyncDescriptionsActionProps {
  modelId: UUID;
  userId: UUID | null;
  onSynced: () => void;
}

/**
 * Bug A2's one-off owner action: models seeded before src/db/seedFromMap.ts's
 * fix have capability elements with a template reference but an empty
 * description. `ghost`, not `primary`/`secondary` — this is a maintenance
 * affordance, not part of the map's normal workflow, and (Button.tsx's own
 * doc comment) that's the tier reserved for exactly this kind of low-drama
 * action. Same owner/architect-at-main gate as the rest of this page
 * (CapabilityMapPage.tsx's `canEdit`) — there's nothing here a contributor
 * or viewer needs, and only owner/architect can commit to main regardless
 * (ADR-015).
 */
export function SyncDescriptionsAction({ modelId, userId, onSynced }: SyncDescriptionsActionProps) {
  const { status, message, error, sync } = useSyncDescriptions({ modelId, userId, onSynced });

  return (
    <div>
      <Button variant="ghost" disabled={status === 'syncing'} onClick={() => void sync()}>
        {status === 'syncing' ? 'Syncing descriptions…' : 'Sync descriptions from starter map'}
      </Button>
      {message !== null && (
        <Text as="p" tone="muted" size="sm">
          {message}
        </Text>
      )}
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
