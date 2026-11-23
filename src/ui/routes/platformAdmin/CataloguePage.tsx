import { CatalogueAdmin } from '../../admin/CatalogueAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue` — the canonical product library and the sector catalogue publications built from it. */
export function CataloguePage() {
  return (
    <PlatformAdminPageShell
      title="Product catalogue"
      intro="One product appears once, with capability links into any number of capability sets. A sector catalogue is a fixed publication that selects products and pins one published set."
      testId="catalogue-admin"
    >
      <CatalogueAdmin embedded />
    </PlatformAdminPageShell>
  );
}
