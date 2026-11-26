import { CatalogueReviewQueue } from '../../admin/CatalogueReviewQueue';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue/review` — claims drafted and not yet reviewed. */
export function CatalogueReviewPage() {
  return (
    <PlatformAdminPageShell
      title="Waiting for review"
      intro="A claim is drafted first and reviewed second. Open the source, check the statement says what the vendor says, then mark it reviewed. Anyone with admin rights can review. Your name and the date are recorded, and a product can only be published once every claim is reviewed."
      testId="catalogue-review"
    >
      <CatalogueReviewQueue />
    </PlatformAdminPageShell>
  );
}
