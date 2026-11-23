import { PlatformAdminView } from '../../admin/PlatformAdminView';
import { PlatformAdminPageShell } from './PlatformAdminPageShell';

/** `/platform-admin/llm-proxy` — application-level LLM proxy settings. */
export function LlmProxyPage() {
  return (
    <PlatformAdminPageShell
      title="LLM proxy"
      intro="Application-level overrides for the llm-proxy edge function — read by every organisation, not per-org."
      testId="llm-proxy-admin"
    >
      <PlatformAdminView embedded />
    </PlatformAdminPageShell>
  );
}
