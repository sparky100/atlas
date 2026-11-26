import { CatalogueSectorsAdmin } from '../../admin/CatalogueSectorsAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue/sectors` — every sector catalogue's standing. */
export function CatalogueSectorsPage() {
  return (
    <PlatformAdminPageShell
      title="Sector catalogues"
      intro="Read-only history. A sector catalogue is a fixed publication that selected products and pinned one capability set; earlier versions stay readable by the citations that name them. Products are now maintained and published one at a time under Products."
    >
      <CatalogueSectorsAdmin />
    </PlatformAdminPageShell>
  );
}
