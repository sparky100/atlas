import { CatalogueTools } from '../../admin/CatalogueTools';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue/tools` — run the checks and the product searches. */
export function CatalogueToolsPage() {
  return (
    <PlatformAdminPageShell
      title="Find and check"
      intro="Tools that search the web and check sources. Anything they find, and anything they could not confirm, goes to Waiting for review for a person to decide."
      testId="catalogue-tools-page"
    >
      <CatalogueTools />
    </PlatformAdminPageShell>
  );
}
