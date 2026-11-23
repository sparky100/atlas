import { SampleModelsAdmin } from '../../admin/SampleModelsAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/sample-models` — published sample models and their sharing state. */
export function SampleModelsPage() {
  return (
    <PlatformAdminPageShell
      title="Sample models"
      intro="Published sample models that new organisations can start from. Withdrawing hides every version of a sample but keeps the published rows for audit."
      testId="sample-models-page"
    >
      <SampleModelsAdmin />
    </PlatformAdminPageShell>
  );
}
