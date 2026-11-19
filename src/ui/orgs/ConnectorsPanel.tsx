import { useId, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { MULESOFT_REGIONS, parseMulesoftConfig, type ConnectorRow, type MulesoftConnectorConfig } from '../../contracts/connectors';
import { findConnector } from '../../db/connectors';
import type { MemberRole } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { formatRelativeTime } from '../time';
import { useConnectors, type UseConnectorsResult } from './useConnectors';
import styles from './OrganisationSettingsView.module.css';

export interface ConnectorsPanelProps {
  orgId: UUID;
  role: MemberRole | null;
}

const REGION_LABELS: Record<(typeof MULESOFT_REGIONS)[number], string> = {
  us: 'United States (anypoint.mulesoft.com)',
  eu: 'Europe (eu1.anypoint.mulesoft.com)',
  gov: 'US government (gov.anypoint.mulesoft.com)',
};

/**
 * Organisation settings, "Connections": link Atlas to another tool so an
 * import can read it directly instead of from an exported file. Owners set
 * a connection up and remove it; owners and architects can test it. The
 * secret is saved encrypted and is never shown again. The file import keeps
 * working exactly as before.
 */
export function ConnectorsPanel({ orgId, role }: ConnectorsPanelProps) {
  const canSee = role === 'owner' || role === 'architect';
  const { connectors, loading, save, remove, test } = useConnectors(canSee ? orgId : null);
  const connector = findConnector(connectors, 'mulesoft');
  return (
    <>
      <Text as="p" tone="muted" size="sm">
        Connect Atlas to another tool so an import can read it directly. Importing from an exported file keeps working as before; a connection is just another way to get the same file. Nothing changes
        in your model until you review the import and apply it.
      </Text>
      {!canSee ? (
        <Text as="p" tone="muted" size="sm">
          Only an owner or architect can see connections.
        </Text>
      ) : loading ? (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      ) : (
        <MulesoftConnection key={connector?.updated_at ?? 'new'} isOwner={role === 'owner'} connector={connector} save={save} remove={remove} test={test} />
      )}
    </>
  );
}

interface MulesoftConnectionProps {
  isOwner: boolean;
  connector: ConnectorRow | null;
  save: UseConnectorsResult['save'];
  remove: UseConnectorsResult['remove'];
  test: UseConnectorsResult['test'];
}

function MulesoftConnection({ isOwner, connector, save, remove, test }: MulesoftConnectionProps) {
  const saved = connector === null ? null : parseMulesoftConfig(connector.config);
  const savedConfig: MulesoftConnectorConfig | null = saved?.ok === true ? saved.config : null;

  const [region, setRegion] = useState<MulesoftConnectorConfig['region']>(savedConfig?.region ?? 'us');
  const [organizationId, setOrganizationId] = useState(savedConfig?.organizationId ?? '');
  const [clientId, setClientId] = useState(savedConfig?.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [environments, setEnvironments] = useState((savedConfig?.environments ?? ['Production']).join(', '));
  const [message, setMessage] = useState<{
    tone: 'ok' | 'problem';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<'saving' | 'testing' | 'removing' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const ids = {
    region: useId(),
    org: useId(),
    client: useId(),
    secret: useId(),
    envs: useId(),
  };

  const draft = parseMulesoftConfig({
    region,
    organizationId,
    clientId,
    environments: environments.split(/[,\n]/),
  });

  return (
    <>
      <div role="group" aria-label="MuleSoft Anypoint connection">
        <Text as="h4" size="md">
          MuleSoft Anypoint {connector !== null ? <Chip tone="ok">Connected</Chip> : <Chip tone="neutral">Not connected</Chip>}
        </Text>
        <details>
          <summary>
            <Text as="span" size="sm">
              How to set this up in Anypoint
            </Text>
          </summary>
          <ol>
            <li>
              <Text as="span" size="sm">
                In Anypoint, open <strong>Access Management</strong> and copy your <strong>organisation ID</strong> (use the business group's ID if you only want that group).
              </Text>
            </li>
            <li>
              <Text as="span" size="sm">
                Still in Access Management, open <strong>Connected Apps</strong> and create an app that <strong>acts on its own behalf</strong> (client credentials).
              </Text>
            </li>
            <li>
              <Text as="span" size="sm">
                Give it <strong>read-only</strong> access to <strong>API Manager</strong> (APIs and their contracts) and to view the organisation's environments, for the environments you want.
                Anypoint's wording for these permissions varies, and Atlas never needs more than read. The <strong>Test connection</strong> button below tells you if something is missing.
              </Text>
            </li>
            <li>
              <Text as="span" size="sm">
                Copy the app's <strong>client ID</strong> and <strong>client secret</strong>. The secret is shown once, and Atlas saves it encrypted and never shows it again.
              </Text>
            </li>
            <li>
              <Text as="span" size="sm">
                Fill in the form below, choose <strong>Save</strong>, then <strong>Test connection</strong>.
              </Text>
            </li>
            <li>
              <Text as="span" size="sm">
                To import, open <strong>Import</strong>, choose <strong>MuleSoft Anypoint</strong> and press <strong>Fetch from MuleSoft</strong>. You then review the result like any other import.
              </Text>
            </li>
          </ol>
        </details>
        {connector !== null && (
          <Text as="p" tone="muted" size="sm">
            {connector.last_fetch_at === null
              ? 'Not used yet.'
              : `Last used ${formatRelativeTime(connector.last_fetch_at, new Date())}: ${connector.last_fetch_status === 'ok' ? 'worked' : 'failed'}${connector.last_fetch_message ? `. ${connector.last_fetch_message}` : '.'}`}
          </Text>
        )}
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.ok) {
              setMessage({ tone: 'problem', text: draft.error });
              return;
            }
            setBusy('saving');
            void save('mulesoft', { ...draft.config }, secret).then((problem) => {
              setBusy(null);
              if (problem === null) {
                setSecret('');
                setMessage({
                  tone: 'ok',
                  text: 'Saved. Choose Test connection to check it works.',
                });
              } else setMessage({ tone: 'problem', text: problem });
            });
          }}
        >
          <label htmlFor={ids.region}>
            <Text as="span" size="sm">
              Region
            </Text>
          </label>
          <select
            id={ids.region}
            className={styles.roleSelect}
            value={region}
            disabled={!isOwner}
            onChange={(e) => {
              setRegion(e.target.value as MulesoftConnectorConfig['region']);
            }}
          >
            {MULESOFT_REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
          <label htmlFor={ids.org}>
            <Text as="span" size="sm">
              Organisation ID
            </Text>
          </label>
          <input
            id={ids.org}
            className={styles.input}
            type="text"
            value={organizationId}
            disabled={!isOwner}
            onChange={(e) => {
              setOrganizationId(e.target.value);
            }}
          />
          <label htmlFor={ids.client}>
            <Text as="span" size="sm">
              Client ID
            </Text>
          </label>
          <input
            id={ids.client}
            className={styles.input}
            type="text"
            value={clientId}
            disabled={!isOwner}
            autoComplete="off"
            onChange={(e) => {
              setClientId(e.target.value);
            }}
          />
          <label htmlFor={ids.secret}>
            <Text as="span" size="sm">
              Client secret
            </Text>
          </label>
          <input
            id={ids.secret}
            className={styles.input}
            type="password"
            value={secret}
            disabled={!isOwner}
            autoComplete="new-password"
            placeholder={connector !== null ? 'Saved. Leave blank to keep it.' : ''}
            onChange={(e) => {
              setSecret(e.target.value);
            }}
          />
          <label htmlFor={ids.envs}>
            <Text as="span" size="sm">
              Environments to read (separate with commas)
            </Text>
          </label>
          <input
            id={ids.envs}
            className={styles.input}
            type="text"
            value={environments}
            disabled={!isOwner}
            onChange={(e) => {
              setEnvironments(e.target.value);
            }}
          />
          {isOwner ? (
            <Button variant="primary" type="submit" disabled={busy !== null || (connector === null && secret.trim() === '')}>
              {busy === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          ) : (
            <Text as="p" tone="muted" size="sm">
              Only an owner can change these settings. You can test the connection.
            </Text>
          )}
        </form>
        {connector !== null && (
          <div className={styles.memberActions}>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setBusy('testing');
                setMessage(null);
                void test('mulesoft').then((result) => {
                  setBusy(null);
                  setMessage(
                    result.status === 'ok' && result.mode === 'test'
                      ? { tone: 'ok', text: result.message }
                      : {
                          tone: 'problem',
                          text: result.status === 'error' ? result.message : 'Unexpected answer.',
                        },
                  );
                });
              }}
            >
              {busy === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
            {isOwner &&
              (confirmRemove ? (
                <>
                  <Button
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy('removing');
                      void remove('mulesoft').then((problem) => {
                        setBusy(null);
                        setConfirmRemove(false);
                        setMessage(
                          problem === null
                            ? {
                                tone: 'ok',
                                text: 'Removed. The saved secret was deleted.',
                              }
                            : { tone: 'problem', text: problem },
                        );
                      });
                    }}
                  >
                    Yes, remove it
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setConfirmRemove(false);
                    }}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirmRemove(true);
                  }}
                >
                  Remove connection
                </Button>
              ))}
          </div>
        )}
        {message !== null && (
          <div role="status">
            <Text as="p" size="sm" tone={message.tone === 'ok' ? 'default' : 'muted'}>
              {message.tone === 'problem' ? 'Problem: ' : ''}
              {message.text}
            </Text>
          </div>
        )}
      </div>
    </>
  );
}
