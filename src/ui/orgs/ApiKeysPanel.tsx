import { useId, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { API_KEY_NAME_MAX, API_KEYS_PER_ORG_MAX, API_RATE_LIMIT_PER_MINUTE } from '../../contracts/api';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { formatDate, formatRelativeTime } from '../time';
import { useApiKeys } from './useApiKeys';
import styles from './OrganisationSettingsView.module.css';

export interface ApiKeysPanelProps {
  orgId: UUID;
  isOwner: boolean;
}

/**
 * Organisation settings, "API access": owners create and revoke the keys that
 * let another tool read this organisation's models over the read-only API.
 * A new key's full text is shown once, right after it is created.
 */
export function ApiKeysPanel({ orgId, isOwner }: ApiKeysPanelProps) {
  const { keys, loading, error, create, revoke } = useApiKeys(isOwner ? orgId : null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const headingId = useId();
  const nameId = useId();
  const active = keys.filter((k) => k.revoked_at === null);

  return (
    <section aria-labelledby={headingId}>
      <Text as="h3" size="md" id={headingId}>
        API access
      </Text>
      <Text as="p" tone="muted" size="sm">
        An API key lets another tool, such as a reporting tool or a script, read this organisation's models: elements, capabilities, relationships and findings. It can only read the current, agreed version, never change anything, and is limited to {API_RATE_LIMIT_PER_MINUTE} requests a minute. Treat a key like a password.
      </Text>
      {!isOwner ? (
        <Text as="p" tone="muted" size="sm">
          Only an owner can create or revoke API keys.
        </Text>
      ) : (
        <>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void create(name.trim()).then((created) => {
                if (created) {
                  setFresh({ name: created.name, token: created.token });
                  setCopied(false);
                  setName('');
                }
              });
            }}
          >
            <label htmlFor={nameId}>
              <Text as="span" size="sm">
                Key name
              </Text>
            </label>
            <input id={nameId} className={styles.input} type="text" maxLength={API_KEY_NAME_MAX} placeholder="For example: Reporting tool" value={name} onChange={(e) => { setName(e.target.value); }} />
            <Button variant="primary" type="submit" disabled={name.trim() === '' || active.length >= API_KEYS_PER_ORG_MAX}>
              Create key
            </Button>
          </form>
          {fresh !== null && (
            <div role="status">
              <Text as="p" size="sm">
                Key "{fresh.name}" created. Copy it now: it will not be shown again.
              </Text>
              <code data-testid="new-api-key">{fresh.token}</code>
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(fresh.token).then(() => { setCopied(true); });
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="ghost" onClick={() => { setFresh(null); }}>
                Done
              </Button>
            </div>
          )}
          {error !== null && <Text as="p">{error}</Text>}
          {!loading && keys.length === 0 && (
            <Text as="p" tone="muted" size="sm">
              No API keys yet.
            </Text>
          )}
          {keys.length > 0 && (
            <ul className={styles.memberList}>
              {keys.map((k) => (
                <li key={k.id} className={styles.memberRow}>
                  <div className={styles.memberIdentity}>
                    <Text as="span">{k.name}</Text>
                    <Text as="span" tone="muted" size="sm">
                      {k.key_prefix}…
                    </Text>
                    {k.revoked_at !== null ? <Chip tone="neutral">Revoked {formatDate(k.revoked_at)}</Chip> : <Chip tone="ok">Active</Chip>}
                    <Text as="span" tone="muted" size="sm">
                      {k.last_used_at ? `Last used ${formatRelativeTime(k.last_used_at, new Date())}` : 'Never used'}
                    </Text>
                  </div>
                  <div className={styles.memberActions}>
                    {k.revoked_at === null && (
                      <Button variant="destructive" aria-label={`Revoke API key ${k.name}`} onClick={() => { void revoke(k.id); }}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
