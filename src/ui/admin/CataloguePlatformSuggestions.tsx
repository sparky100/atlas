import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { acceptPlatformSuggestion, listPlatformSuggestions, rejectPlatformSuggestion } from '../../db/catalogueAdmin';
import type { PlatformSuggestion } from '../../tools/cataloguePlatformSuggestions';
import { supabase } from '../supabaseClient';
import styles from './CatalogueAdmin.module.css';

const suggestionKey = (suggestion: PlatformSuggestion) => `${suggestion.vendor}|${suggestion.platformKey}`;

/**
 * Products by the same vendor whose names start the same way, offered as the
 * components of one platform ("Oracle Utilities Meter Data Management" and
 * "Oracle Utilities Customer Care and Billing"). Only a suggestion: a person
 * ticks the products that really are components and confirms. When the platform
 * is not in the library yet it is added as a draft with no links or claims.
 * Turning a suggestion down is remembered, with who and when.
 */
export function CataloguePlatformSuggestions({ onChanged, onCount }: { onChanged?: () => void; onCount?: (count: number) => void } = {}) {
  const [suggestions, setSuggestions] = useState<PlatformSuggestion[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setSuggestions(await listPlatformSuggestions(supabase));
  }, []);

  useEffect(() => {
    void listPlatformSuggestions(supabase)
      .then(setSuggestions)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { setLoading(false); });
  }, []);

  useEffect(() => {
    if (!loading) onCount?.(suggestions.length);
  }, [loading, suggestions.length, onCount]);

  const act = async (work: () => Promise<string>) => {
    setBusy(true); setError(''); setNotice('');
    try {
      setNotice(await work());
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await load().catch(() => undefined);
      setBusy(false);
    }
  };

  const toggle = (productId: string, on: boolean) => {
    setSkipped((current) => {
      const next = new Set(current);
      if (on) next.delete(productId); else next.add(productId);
      return next;
    });
  };

  if (loading) return null;
  if (error !== '' && suggestions.length === 0) return <p role="alert" className={styles.error}>{error}</p>;
  if (suggestions.length === 0 && notice === '') return null;

  return (
    <section className={styles.panel} aria-label="Suggested platforms" data-testid="platform-suggestions">
      <p>Products by the same vendor that look like parts of one platform. Tick the ones that really are components and confirm. Nothing changes until you do.</p>
      {notice !== '' && <p role="status">{notice}</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {suggestions.length > 0 && (
        <div className={styles.pairList} data-testid="platform-suggestion-list">
          <div className={styles.groupBody}>
            {suggestions.map((suggestion) => {
              const chosen = suggestion.components.filter((component) => !skipped.has(component.id));
              return (
                <div key={suggestionKey(suggestion)} className={styles.resultRow} data-testid="platform-suggestion">
                  <p><strong>{suggestion.platformName}</strong> <small>({suggestion.vendor})</small></p>
                  <small>
                    {suggestion.platformId === null
                      ? 'Not in the library yet. Confirming adds it as a draft with no links and no claims, to describe and source before publishing.'
                      : <>Already in the library: <Link to={`/platform-admin/catalogue/products/${suggestion.platformId}`}>{suggestion.platformName}</Link>.</>}
                  </small>
                  {suggestion.components.map((component) => (
                    <div key={component.id} className={styles.checkLine}>
                      <input type="checkbox" aria-label={component.product} checked={!skipped.has(component.id)} disabled={busy} onChange={(event) => { toggle(component.id, event.target.checked); }} />
                      <span><Link to={`/platform-admin/catalogue/products/${component.id}`}>{component.product}</Link></span>
                    </div>
                  ))}
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      disabled={busy || chosen.length === 0}
                      onClick={() => {
                        void act(async () => {
                          const result = await acceptPlatformSuggestion(supabase, suggestion, chosen.map((component) => component.id));
                          return `${String(result.linked)} product${result.linked === 1 ? ' is' : 's are'} now part of ${suggestion.platformName}${result.created ? ', which was added as a draft to describe and source' : ''}. Recorded with your name.`;
                        });
                      }}
                    >
                      Make {String(chosen.length)} selected part of {suggestion.platformName}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void act(async () => {
                          await rejectPlatformSuggestion(supabase, suggestion.platformKey, suggestion.components.map((component) => component.id));
                          return `Not suggesting ${suggestion.platformName} for these products again.`;
                        });
                      }}
                    >
                      Not a platform: stop suggesting this
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
