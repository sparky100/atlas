import { useParams } from 'react-router';
import { CatalogueProductAdmin } from '../../admin/CatalogueProductAdmin';

/** `/platform-admin/catalogue/products/new` and `.../products/:productId`. */
export function CatalogueProductPage() {
  const { productId } = useParams<{ productId: string }>();
  return <CatalogueProductAdmin productId={productId ?? null} />;
}
