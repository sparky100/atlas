import { useParams } from 'react-router';
import { CapabilitySetVersionAdmin } from '../../admin/CapabilitySetVersionAdmin';

/** `/platform-admin/capability-sets/versions/:mapId` — one fixed capability-set version. */
export function CapabilitySetVersionPage() {
  const { mapId } = useParams<{ mapId: string }>();
  return <CapabilitySetVersionAdmin mapId={mapId ?? ''} />;
}
