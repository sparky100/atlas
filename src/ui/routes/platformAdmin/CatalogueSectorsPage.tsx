import { CatalogueSectorsAdmin } from '../../admin/CatalogueSectorsAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue/sectors` — every sector catalogue's standing. */
export function CatalogueSectorsPage() {
  return (
    <PlatformAdminPageShell
      title="Sector catalogues"
      intro="A sector catalogue is a fixed publication that selects products and pins one published capability set. Earlier versions stay readable by their citations."
    >
      <CatalogueSectorsAdmin />
    </PlatformAdminPageShell>
  );
}
