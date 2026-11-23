import { Loading } from '../components/Loading/Loading';
import { useId, useState } from 'react';
import { LLM_PROXY_MODEL_OPTIONS, LLM_PROXY_PROVIDER_OPTIONS, useLlmProxyConfig } from './useLlmProxyConfig';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { SettingsSection } from '../components/SettingsSection/SettingsSection';
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
 *
 * Provider and Model are both real, enabled pickers driven by
 * `LLM_PROXY_PROVIDER_OPTIONS`/`LLM_PROXY_MODEL_OPTIONS` — same shape as
 * `ModelSettingsView.tsx`'s own version-select convention, and deliberately
 * not tied to Anthropic in the UI or the config schema even though
 * `llm-proxy`'s own routing is Anthropic-only today (ADR-014's scope
 * narrowing; `20260921020000_platform_llm_provider.sql`'s own module
 * comment has the fuller reasoning). `LLM_PROXY_PROVIDER_OPTIONS` happens
 * to hold one entry right now — adding a second provider's routing to
 * `llm-proxy` and its own allow-list is the only other change a second
 * choice here needs. For both pickers, if the currently-saved value isn't
 * one of the listed options (an older or since-retired id), it's added as
 * an extra option rather than silently replaced, so opening this form
 * never itself changes what's live.
 */
export function PlatformAdminView({ embedded = false }: { embedded?: boolean }) {
  const { status, error, provider, model, rateLimitPerHour, hasApiKey, setProvider, setModel, setRateLimitPerHour, save } = useLlmProxyConfig();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const providerId = useId();
  const modelId = useId();
  const rateLimitId = useId();
  const apiKeyId = useId();
  const providerOptions = LLM_PROXY_PROVIDER_OPTIONS.some((option) => option.id === provider)
    ? LLM_PROXY_PROVIDER_OPTIONS
    : [{ id: provider, label: `${provider} (currently set)` }, ...LLM_PROXY_PROVIDER_OPTIONS];
  const modelOptions = LLM_PROXY_MODEL_OPTIONS.some((option) => option.id === model)
    ? LLM_PROXY_MODEL_OPTIONS
    : [{ id: model, label: `${model} (currently set)` }, ...LLM_PROXY_MODEL_OPTIONS];

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

  const body = (
    <>
      <Text as="p" tone="muted" size="sm">
        Application-level overrides for the `llm-proxy` edge function — read by every organisation, not per-org. Falls back to the function&apos;s own Supabase secrets when unset.
      </Text>

      {status === 'loading' && <Loading />}

      {status !== 'loading' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={styles.field}>
            <label htmlFor={providerId}>
              <Text as="span" size="sm" tone="muted">
                Provider
              </Text>
            </label>
            <select
              id={providerId}
              className={styles.input}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
              }}
            >
              {providerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor={modelId}>
              <Text as="span" size="sm" tone="muted">
                Model
              </Text>
            </label>
            <select
              id={modelId}
              className={styles.input}
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
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
    </>
  );

  return embedded ? body : (
    <SettingsSection id="llm-proxy" title="LLM proxy" summary={hasApiKey ? `${provider} · key set` : 'Using function defaults'}>
      {body}
    </SettingsSection>
  );
}
