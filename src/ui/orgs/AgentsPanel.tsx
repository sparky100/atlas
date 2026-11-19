import { useState } from 'react';
import { getOrganisationById } from '../../db/organisations';
import { removeOrgAiKey, saveOrgAiKey } from '../../db/orgAiKey';
import type { OrganisationRow } from '../../db/types';
import { supabase } from '../supabaseClient';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import styles from './OrganisationSettingsView.module.css';

export interface AgentsPanelProps {
  organisation: OrganisationRow;
  canManage: boolean;
  /** Switch agents on or off (the organisation's own update, owner-only through RLS). */
  onToggleAgents: (enabled: boolean) => void;
  saving: boolean;
  onChanged: (organisation: OrganisationRow) => void;
}

/** Phase D step 1: the organisation's own AI key for agents, and the switch. No agent is released yet; this prepares the organisation. */
export function AgentsPanel({ organisation, canManage, onToggleAgents, saving, onChanged }: AgentsPanelProps) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setKey('');
      const fresh = await getOrganisationById(supabase, organisation.id);
      if (fresh) onChanged(fresh);
    } catch (e) {
      // The service's own plain sentence, never the key.
      setMessage(e instanceof Error ? e.message : failure);
      reportError(failure, e);
    } finally {
      setBusy(false);
    }
  }

  const keySet = organisation.ai_agent_key_set;
  const ready = organisation.ai_assistant_enabled && keySet;
  return (
    <>
      <Text as="p" tone="muted" size="sm">
        Agents will draft and review on your organisation's own AI key, because they use a lot of AI time. Ask Atlas, document import and help keep using Atlas's own key and are not affected. No agent has been released yet: saving a key and turning agents on prepares your organisation and does nothing else today. The key is stored securely, is never shown again, and can be replaced or removed here. Removing it turns agents off.
      </Text>
      <Text as="p" size="sm">
        AI key: <Chip tone="neutral">{keySet ? 'Set' : 'Not set'}</Chip>
      </Text>
      {canManage && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => saveOrgAiKey(supabase, organisation.id, key), 'Could not save the AI key.');
          }}
        >
          <label htmlFor="org-ai-key">
            <Text as="span" size="sm">
              {keySet ? 'Replace the AI key' : 'AI key'}
            </Text>
          </label>
          <input id="org-ai-key" className={styles.input} type="password" autoComplete="off" value={key} disabled={busy} onChange={(e) => { setKey(e.target.value); }} />
          <div>
            <Button type="submit" disabled={busy || key.trim() === ''}>
              Save key
            </Button>{' '}
            {keySet && (
              <Button type="button" disabled={busy} onClick={() => { void run(() => removeOrgAiKey(supabase, organisation.id), 'Could not remove the AI key.'); }}>
                Remove key
              </Button>
            )}
          </div>
        </form>
      )}
      <label className={styles.checkRow}>
        <input type="checkbox" checked={organisation.ai_agents_enabled} disabled={!canManage || saving || busy || !ready} onChange={(e) => { onToggleAgents(e.target.checked); }} />
        <Text as="span" size="sm">
          Allow agents for this organisation
        </Text>
      </label>
      {!ready && (
        <Text as="p" tone="muted" size="sm">
          Needs Ask Atlas switched on and an AI key saved.
        </Text>
      )}
      {!canManage && (
        <Text as="p" tone="muted" size="sm">
          Only an owner can change this.
        </Text>
      )}
      {message !== null && <Text as="p">{message}</Text>}
    </>
  );
}
