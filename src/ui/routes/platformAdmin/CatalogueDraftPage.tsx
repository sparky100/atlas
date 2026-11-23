import { useParams } from 'react-router';
import { CatalogueDraftAdmin } from '../../admin/CatalogueDraftAdmin';

/** `/platform-admin/catalogue/sectors/:sector/drafts/:draftId`. */
export function CatalogueDraftPage() {
  const { draftId } = useParams<{ draftId: string }>();
  return <CatalogueDraftAdmin draftId={draftId ?? ''} />;
}
