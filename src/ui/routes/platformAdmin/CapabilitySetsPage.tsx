import { CapabilitySetsAdmin } from '../../admin/CapabilitySetsAdmin';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/capability-sets` — platform starter maps, their versions and their drafts. */
export function CapabilitySetsPage() {
  return (
    <PlatformAdminPageShell
      title="Capability sets"
      intro="Platform starter maps. Publishing creates a new fixed version; models already seeded from an earlier version are not changed."
    >
      <CapabilitySetsAdmin />
    </PlatformAdminPageShell>
  );
}
