import { CatalogueProductsAdmin } from '../../admin/CatalogueProductsAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue` — the canonical product library. */
export function CataloguePage() {
  return (
    <PlatformAdminPageShell
      title="Product catalogue"
      intro="One product appears once, with capability links into any number of capability sets. Choose a product to edit it, or add a new one."
      testId="catalogue-admin"
    >
      <CatalogueProductsAdmin />
    </PlatformAdminPageShell>
  );
}
