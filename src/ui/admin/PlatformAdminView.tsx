import { useId, useState } from 'react';
import { useLlmProxyConfig } from './useLlmProxyConfig';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import styles from './PlatformAdminView.module.css';

/**
 * The `/platform-admin` page's own content — application-level LLM proxy
 * settings (E4 follow-up, `platform_admin`'s own migration comment for the
 * full design). One `Panel`, mirroring `OrganisationSettingsView.tsx`'s
 * per-section shape. The API key field is write-only: `useLlmProxyConfig`
 * never holds the raw key in state, only `hasApiKey` — this form shows
 * "API key set"/"API key not set" and an input labelled to make clear that
 * leaving it blank keeps whatever is already configured, never displaying
 * or round-tripping a live secret.
 */
export function PlatformAdminView() {
  const { status, error, model, rateLimitPerHour, hasApiKey, setModel, setRateLimitPerHour, save } = useLlmProxyConfig();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const modelId = useId();
  const rateLimitId = useId();
  const apiKeyId = useId();

  const submit = () => {
    const trimmedKey = apiKeyInput.trim();
    void save(trimmedKey === '' ? {} : { apiKey: trimmedKey }).then((saved) => {
      if (saved) setApiKeyInput('');
    });
  };

  const clearApiKey = () => {
    void save({ clearApiKey: true }).then((saved) => {
      if (saved) setApiKeyInput('');
    });
  };

  return (
    <Panel raised className={styles.panel ?? ''}>
      <Text as="h2" size="lg">
        LLM proxy
      </Text>
      <Text as="p" tone="muted" size="sm">
        Application-level overrides for the `llm-proxy` edge function — read by every organisation, not per-org. Falls back to the function&apos;s own Supabase secrets when unset.
      </Text>

      {status === 'loading' && <Text tone="muted">Loading…</Text>}

      {status !== 'loading' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={styles.field}>
            <label htmlFor={modelId}>
              <Text as="span" size="sm" tone="muted">
                Model
              </Text>
            </label>
            <input
              id={modelId}
              type="text"
              className={styles.input}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={rateLimitId}>
              <Text as="span" size="sm" tone="muted">
                Rate limit (requests/hour, per organisation)
              </Text>
            </label>
            <input
              id={rateLimitId}
              type="number"
              min={1}
              className={styles.input}
              value={rateLimitPerHour}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(parsed)) setRateLimitPerHour(parsed);
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={apiKeyId}>
              <Text as="span" size="sm" tone="muted">
                API key ({hasApiKey ? 'set — leave blank to keep it' : 'not set — falls back to ANTHROPIC_API_KEY'})
              </Text>
            </label>
            <input
              id={apiKeyId}
              type="password"
              className={styles.input}
              placeholder={hasApiKey ? '••••••••' : 'sk-ant-…'}
              value={apiKeyInput}
              onChange={(e) => {
                setApiKeyInput(e.target.value);
              }}
              autoComplete="off"
            />
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            {hasApiKey && (
              <Button variant="ghost" type="button" onClick={clearApiKey} disabled={status === 'saving'}>
                Clear API key
              </Button>
            )}
          </div>
        </form>
      )}

      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </Panel>
  );
}
