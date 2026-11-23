import { PlatformAdminOverview } from '../../admin/PlatformAdminOverview';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin` — the section's index: every organisation and person, read-only. */
export function OverviewPage() {
  return (
    <PlatformAdminPageShell
      title="Platform admin"
      intro="Every organisation and person on this deployment, with last sign-in and last change."
      testId="platform-admin-overview"
    >
      <PlatformAdminOverview />
    </PlatformAdminPageShell>
  );
}
