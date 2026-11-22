import { useEffect, useId, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { WebResearchCandidate } from '../../contracts/webResearch';
import { requestWebResearch, saveCheckedWebSource } from '../../db/webResearch';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { researchQueryProblem, WEB_RESEARCH_QUERY_MAX } from './webResearchQuery';
import styles from './WebResearchDialog.module.css';

export interface WebResearchDialogProps {
  decisionId: UUID;
  branchId: UUID;
  optionLabel: string;
  userId: UUID;
  /** Pages already saved with this option, so a second save does not collide. */
  existingUrls: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * The guarded Researcher's person-facing half. The person writes and approves
 * the exact text, sees the pages Anthropic returned with the provider's cited
 * sentence, then says what one page supports and confirms they checked it.
 * Nothing is saved until that check; the search itself is already recorded in
 * `web_research_requests` by the server.
 */
export function WebResearchDialog({ decisionId, branchId, optionLabel, userId, existingUrls, onClose, onSaved }: WebResearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const queryId = useId();
  const [query, setQuery] = useState('');
  const [approved, setApproved] = useState(false);
  const [phase, setPhase] = useState<'query' | 'results'>('query');
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [results, setResults] = useState<WebResearchCandidate[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [assertion, setAssertion] = useState('');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = searching || saving;
  const existing = new Set(existingUrls);
  const available = results.filter((candidate) => !existing.has(candidate.url));
  const selected = available.find((candidate) => candidate.url === selectedUrl) ?? null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    queryRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    // A click on the backdrop lands on the <dialog> element itself, never on
    // its content; closing there matches every other overlay in the app.
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog && !busy) onClose();
    };
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('click', onClick);
    };
  }, [busy, onClose]);

  function requestClose(): void {
    if (busy) return;
    onClose();
  }

  async function runSearch(): Promise<void> {
    const problem = researchQueryProblem(query);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (!approved) {
      setError('Tick that you approve this exact text before searching.');
      return;
    }
    const exact = query.trim();
    setSearching(true);
    setError(null);
    try {
      const response = await requestWebResearch(supabase, { decisionId, branchId, query: exact });
      setSearchedQuery(exact);
      setSearchedAt(response.searchedAt);
      setResults(response.candidates);
      setSelectedUrl(null);
      setAssertion('');
      setChecked(false);
      setPhase('results');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The web search failed. Try again.');
    } finally {
      setSearching(false);
    }
  }

  async function save(): Promise<void> {
    if (!selected || assertion.trim() === '' || !checked) return;
    setSaving(true);
    setError(null);
    try {
      await saveCheckedWebSource(supabase, { decisionId, branchId, userId, candidate: selected, assertion });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this page. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <div className={styles.body}>
        <div className={styles.header}>
          <div>
            <Text as="h2" size="lg">
              <span id={headingId}>Research the web</span>
            </Text>
            <Text as="p" size="sm" tone="muted">
              For {optionLabel}
            </Text>
          </div>
          <Button variant="ghost" aria-label="Close" disabled={busy} onClick={requestClose}>
            ×
          </Button>
        </div>

        {phase === 'query' ? (
          <>
            <Text as="p" size="sm" tone="muted">
              Write what you want to find on the public web. The exact text below is sent to Anthropic&apos;s web search and recorded with the decision. Do not include private model, customer or organisation detail.
            </Text>
            <label htmlFor={queryId}>
              <Text as="span" size="sm">
                What should the Researcher search for?
              </Text>
            </label>
            <textarea
              id={queryId}
              ref={queryRef}
              className={styles.textarea}
              rows={3}
              maxLength={WEB_RESEARCH_QUERY_MAX}
              value={query}
              disabled={searching}
              onChange={(event) => {
                setQuery(event.target.value);
                setApproved(false);
                setError(null);
              }}
              placeholder="For example: Oracle utilities customer service billing"
            />
            <Text as="p" size="xs" tone="muted">
              {query.trim().length}/{WEB_RESEARCH_QUERY_MAX} characters. Leading and trailing spaces are not sent.
            </Text>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={approved}
                disabled={searching || query.trim() === ''}
                onChange={(event) => {
                  setApproved(event.target.checked);
                  setError(null);
                }}
              />
              <Text as="span" size="sm">
                I approve this exact text for a public web search.
              </Text>
            </label>
            <div className={styles.actions}>
              <Button variant="primary" disabled={searching || query.trim() === '' || !approved} onClick={() => void runSearch()}>
                {searching ? 'Searching.' : 'Search the web'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={requestClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <Text as="p" size="sm" tone="muted">
              The exact text sent was:
            </Text>
            <blockquote className={styles.exact}>{searchedQuery}</blockquote>
            {searchedAt !== null && (
              <Text as="p" size="xs" tone="muted">
                Searched {new Date(searchedAt).toLocaleString('en-GB')}. The search is recorded with this decision.
              </Text>
            )}
            <Text as="h3" size="sm">
              Pages the search returned
            </Text>
            {results.length === 0 ? (
              <Text as="p" size="sm">
                No pages came back. Try a different query.
              </Text>
            ) : available.length === 0 ? (
              <Text as="p" size="sm">
                Every page returned is already saved with this option. Try a different query.
              </Text>
            ) : (
              <div className={styles.results} role="radiogroup" aria-label="Pages returned by the search">
                {available.map((candidate) => (
                  <label key={candidate.url} className={[styles.candidate, selectedUrl === candidate.url ? styles.candidateSelected : ''].filter(Boolean).join(' ')}>
                    <input
                      type="radio"
                      name="web-research-candidate"
                      checked={selectedUrl === candidate.url}
                      onChange={() => {
                        setSelectedUrl(candidate.url);
                        setAssertion('');
                        setChecked(false);
                        setError(null);
                      }}
                    />
                    <span className={styles.candidateBody}>
                      <a href={candidate.url} target="_blank" rel="noreferrer">
                        <Text as="span" size="sm">
                          {candidate.title}
                        </Text>
                      </a>
                      <Text as="span" size="xs" tone="muted">
                        {candidate.publisher === '' ? candidate.url : candidate.publisher}
                      </Text>
                      {candidate.excerpt !== null ? (
                        <Text as="span" size="sm" tone="muted">
                          “{candidate.excerpt}”
                        </Text>
                      ) : (
                        <Text as="span" size="xs" tone="muted">
                          No excerpt was returned. Open the page and read it before saving.
                        </Text>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {selected !== null && (
              <div className={styles.checkBlock}>
                <Text as="h3" size="sm">
                  What does this page support?
                </Text>
                <Text as="p" size="sm" tone="muted">
                  Write one sentence, in your own words. A reader will see it as your check, not as a catalogue claim.
                </Text>
                <textarea
                  className={styles.textarea}
                  rows={2}
                  maxLength={500}
                  value={assertion}
                  disabled={saving}
                  onChange={(event) => {
                    setAssertion(event.target.value);
                    setError(null);
                  }}
                  placeholder="For example: Oracle lists utility customer service as a product."
                />
                <Text as="p" size="xs" tone="muted">
                  {assertion.trim().length}/500 characters
                </Text>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving || assertion.trim() === ''}
                    onChange={(event) => {
                      setChecked(event.target.checked);
                      setError(null);
                    }}
                  />
                  <Text as="span" size="sm">
                    I opened this page and checked that it supports this statement.
                  </Text>
                </label>
                <div className={styles.actions}>
                  <Button variant="primary" disabled={saving || assertion.trim() === '' || !checked} onClick={() => void save()}>
                    {saving ? 'Saving.' : 'Save page and check'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPhase('query');
                      setResults([]);
                      setSelectedUrl(null);
                      setAssertion('');
                      setChecked(false);
                      setError(null);
                    }}
                  >
                    Search again
                  </Button>
                </div>
              </div>
            )}
            {selected === null && available.length > 0 && (
              <Text as="p" size="sm" tone="muted">
                Choose one page to check and save.
              </Text>
            )}
            <div className={styles.actions}>
              <Button variant="ghost" disabled={busy} onClick={requestClose}>
                Close
              </Button>
            </div>
          </>
        )}

        {error !== null && (
          <div role="alert">
            <Text as="p" size="sm">
              {error}
            </Text>
          </div>
        )}
      </div>
    </dialog>
  );
}
