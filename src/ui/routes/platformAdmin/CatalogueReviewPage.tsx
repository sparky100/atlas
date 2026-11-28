import { CatalogueReviewQueue } from '../../admin/CatalogueReviewQueue';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/catalogue/review` — everything waiting for a person to decide. */
export function CatalogueReviewPage() {
  return (
    <PlatformAdminPageShell
      title="Waiting for review"
      intro="What needs a person to decide. A claim is drafted first and reviewed second, and a product can only be published once every claim is reviewed. Anyone with admin rights can review. Your name and the date are recorded."
      testId="catalogue-review"
    >
      <CatalogueReviewQueue />
    </PlatformAdminPageShell>
  );
}
