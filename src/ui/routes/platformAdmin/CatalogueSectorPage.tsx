import { useParams } from 'react-router';
import { CatalogueSectorAdmin } from '../../admin/CatalogueSectorAdmin';

/** `/platform-admin/catalogue/sectors/:sector`. */
export function CatalogueSectorPage() {
  const { sector } = useParams<{ sector: string }>();
  return <CatalogueSectorAdmin sector={sector ?? ''} />;
}
