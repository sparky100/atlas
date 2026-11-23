import { useParams } from 'react-router';
import { CapabilitySetDraftAdmin } from '../../admin/CapabilitySetDraftAdmin';

/** `/platform-admin/capability-sets/drafts/:draftId` — one editable capability-set draft. */
export function CapabilitySetDraftPage() {
  const { draftId } = useParams<{ draftId: string }>();
  return <CapabilitySetDraftAdmin draftId={draftId ?? ''} />;
}
