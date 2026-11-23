import { useParams } from 'react-router';
import { CatalogueVersionAdmin } from '../../admin/CatalogueVersionAdmin';

/** `/platform-admin/catalogue/sectors/:sector/versions/:catalogueId`. */
export function CatalogueVersionPage() {
  const { sector, catalogueId } = useParams<{ sector: string; catalogueId: string }>();
  return <CatalogueVersionAdmin sector={sector ?? ''} catalogueId={catalogueId ?? ''} />;
}
