import { ReferenceMapAdmin } from '../../admin/ReferenceMapAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/capability-sets` — platform starter maps and their drafts. */
export function CapabilitySetsPage() {
  return (
    <PlatformAdminPageShell
      title="Capability sets"
      intro="Platform starter maps. Publishing creates a new fixed version; models already seeded from an earlier version are not changed."
      testId="capability-sets-admin"
    >
      <ReferenceMapAdmin embedded />
    </PlatformAdminPageShell>
  );
}
