import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { DECISION_GAP_BODY_MAX, decisionGapProblem } from '../../contracts/decisionGap';
import type { WebResearchCandidate } from '../../contracts/webResearch';
import { requestWebResearch, saveCheckedWebSource } from '../../db/webResearch';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { researchOptionTitle } from './researchOptionText';
import { ResearchResultCard, type ResearchCardAction } from './ResearchResultCard';
import { catalogueMatchFor, type KnownCatalogueProduct } from './researchCatalogueMatches';
import { buildResearchQuery, suggestResearchQuery, type ResearchProduct } from './researchQuerySuggestion';
import { researchQueryProblem, WEB_RESEARCH_QUERY_MAX } from './webResearchQuery';
import styles from './WebResearchDialog.module.css';

export interface WebResearchDialogProps {
  decisionId: UUID;
  /** The candidate option being researched; it need not have a change. */
  optionId: UUID;
  /** The option's change, when it has one. */
  branchId: UUID | null;
  optionLabel: string;
  /** The decision's own title, used only to suggest a query, never sent automatically. */
  decisionTitle: string;
  /** Capabilities the decision concerns, from structured links. */
  capabilityNames: readonly string[];
  /** Products and vendors already saved with this option as reviewed catalogue sources. */
  productNames?: readonly string[];
  vendorNames?: readonly string[];
  /** The same products with their vendors, so a chosen product is scored with its own vendor. */
  optionProducts?: readonly ResearchProduct[];
  /** Reviewed catalogue products, so a web page can be marked as "looks like the same product". */
  catalogueProducts?: readonly KnownCatalogueProduct[];
  userId: UUID;
  /** Pages already saved with this option, so a second save does not collide. */
  existingUrls: readonly string[];
  /** Pages saved with another option of this decision, shown as reuse rather than rediscovered. */
  citedElsewhereUrls?: readonly string[];
  /** Pages an earlier approved search on this decision returned. */
  earlierSearchUrls?: readonly string[];
  onClose: () => void;
  onSaved: () => void;
  /** Creates a new option from a returned page. Returns a warning when the option was made but its source was not saved. */
  onUseAsOption: (candidate: WebResearchCandidate, optionId: UUID) => Promise<string | null>;
  /** Saves a short note about what the search could not find, on this option. */
  onRecordGap: (body: string) => Promise<void>;
}

/**
 * The guarded Researcher's person-facing half. The person writes and approves
 * the exact text, sees the pages Anthropic returned with the provider's cited
 * sentence, then says what one page supports and confirms they checked it.
 * Nothing is saved until that check; the search itself is already recorded in
 * `web_research_requests` by the server.
 *
 * A suggested query is offered from structured fields on screen, but nothing
 * is searched automatically: the same exact-text approval still stands.
 */
export function WebResearchDialog({
  decisionId,
  optionId: researchedOptionId,
  branchId,
  optionLabel,
  decisionTitle,
  capabilityNames,
  productNames = [],
  vendorNames = [],
  optionProducts = [],
  catalogueProducts = [],
  userId,
  existingUrls,
  citedElsewhereUrls = [],
  earlierSearchUrls = [],
  onClose,
  onSaved,
  onUseAsOption,
  onRecordGap,
}: WebResearchDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const headingId = useId();
  const queryId = useId();
  const productSelectId = useId();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  // Stable keys keep the suggestion memo from rebuilding on every render while
  // still reacting when a late capability read arrives.
  const capabilityKey = capabilityNames.join('\u0000');
  const productKey = productNames.join('\u0000');
  const vendorKey = vendorNames.join('\u0000');
  const suggestion = useMemo(() => {
    const split = (key: string) => (key === '' ? [] : key.split('\u0000'));
    return suggestResearchQuery({
      optionLabel,
      decisionTitle,
      capabilityNames: split(capabilityKey),
      productNames: split(productKey),
      vendorNames: split(vendorKey),
      optionProducts,
      selectedProductName: selectedProduct ?? undefined,
    });
  }, [optionLabel, decisionTitle, capabilityKey, productKey, vendorKey, optionProducts, selectedProduct]);

  // The suggestion is the default; state holds only what the person changes.
  // A late capability read therefore improves an untouched suggestion without
  // ever overwriting an edit, and no synchronising effect is needed.
  const [chipsState, setChipsState] = useState<string[] | null>(null);
  const [queryState, setQueryState] = useState<string | null>(null);
  const [approvedQuery, setApprovedQuery] = useState<string | null>(null);
  const [phase, setPhase] = useState<'query' | 'results'>('query');
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [results, setResults] = useState<WebResearchCandidate[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [added, setAdded] = useState<Record<string, string>>({});
  // One stable id per page, so a retry after a partial failure finishes the
  // same option instead of creating a second one.
  const [optionIds, setOptionIds] = useState<Record<string, UUID>>({});
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [assertion, setAssertion] = useState('');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
  const [gapOpen, setGapOpen] = useState(false);
  const [gapBody, setGapBody] = useState('');
  const [gapSaving, setGapSaving] = useState(false);
  const [gapError, setGapError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chips = chipsState ?? suggestion.chips;
  const query = queryState ?? suggestion.query;
  const approved = approvedQuery === query && query.trim() !== '';
  const capabilityLabel = capabilityNames.length > 0 ? capabilityNames.join(', ') : 'this capability';
  const busy = searching || saving || addingUrl !== null || gapSaving;
  const existing = new Set(existingUrls);
  const citedElsewhere = new Set(citedElsewhereUrls);
  const earlierSearch = new Set(earlierSearchUrls);
  const visible = results.filter((candidate) => !dismissed.includes(candidate.url));
  const selectable = results.filter((candidate) => !existing.has(candidate.url) && added[candidate.url] === undefined && !dismissed.includes(candidate.url));
  const selected = selectable.find((candidate) => candidate.url === selectedUrl) ?? null;

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

  function removeChip(chip: string): void {
    const remaining = chips.filter((value) => value !== chip);
    const queryStillMatchesChips = query === buildResearchQuery(chips, suggestion.intent);
    setChipsState(remaining);
    if (queryStillMatchesChips) setQueryState(buildResearchQuery(remaining, suggestion.intent));
    setApprovedQuery(null);
    setError(null);
  }

  function chooseProduct(value: string): void {
    setSelectedProduct(value);
    setChipsState(null);
    setQueryState(null);
    setApprovedQuery(null);
    setError(null);
  }

  function clearSuggestion(): void {
    setChipsState([]);
    setQueryState('');
    setApprovedQuery(null);
    setError(null);
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
    setNotice(null);
    try {
      const response = await requestWebResearch(supabase, { decisionId, optionId: researchedOptionId, query: exact });
      setSearchedQuery(exact);
      setSearchedAt(response.searchedAt);
      setResults(response.candidates);
      setDismissed([]);
      setAdded({});
      setSelectedUrl(null);
      setAssertion('');
      setChecked(false);
      setGapOpen(false);
      setGapBody('');
      setGapError(null);
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
      await saveCheckedWebSource(supabase, { decisionId, optionId: researchedOptionId, branchId, userId, candidate: selected, assertion });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this page. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function addAsOption(candidate: WebResearchCandidate): Promise<void> {
    setAddingUrl(candidate.url);
    setError(null);
    setNotice(null);
    try {
      const optionId = optionIds[candidate.url] ?? crypto.randomUUID();
      if (optionIds[candidate.url] === undefined) setOptionIds((prev) => ({ ...prev, [candidate.url]: optionId }));
      const warning = await onUseAsOption(candidate, optionId);
      setAdded((prev) => ({ ...prev, [candidate.url]: researchOptionTitle(candidate) }));
      if (selectedUrl === candidate.url) {
        setSelectedUrl(null);
        setAssertion('');
        setChecked(false);
      }
      setNotice(warning ?? `Added a new option: ${researchOptionTitle(candidate)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add an option from this page. Try again.');
    } finally {
      setAddingUrl(null);
    }
  }

  async function saveGap(): Promise<void> {
    const problem = decisionGapProblem(gapBody);
    if (problem !== null) {
      setGapError(problem);
      return;
    }
    setGapSaving(true);
    setGapError(null);
    try {
      await onRecordGap(gapBody.trim());
      setGapOpen(false);
      setGapBody('');
      setNotice('Recorded what you could not find.');
    } catch (e) {
      setGapError(e instanceof Error ? e.message : 'Could not save what you could not find. Try again.');
    } finally {
      setGapSaving(false);
    }
  }

  function select(candidate: WebResearchCandidate): void {
    setSelectedUrl(candidate.url);
    setAssertion('');
    setChecked(false);
    setError(null);
    setNotice(null);
  }

  function backToQuery(): void {
    setPhase('query');
    setResults([]);
    setDismissed([]);
    setAdded({});
    setSelectedUrl(null);
    setAssertion('');
    setChecked(false);
    setGapOpen(false);
    setGapBody('');
    setGapError(null);
    setNotice(null);
    setError(null);
  }

  function statusFor(candidate: WebResearchCandidate): { label: string; tone: 'neutral' | 'warn' | 'ok' | 'info' } {
    if (existing.has(candidate.url)) return { label: 'Already saved with this option', tone: 'neutral' };
    if (added[candidate.url] !== undefined) return { label: 'Added as an option', tone: 'ok' };
    if (citedElsewhere.has(candidate.url)) return { label: 'Cited by another option', tone: 'info' };
    if (earlierSearch.has(candidate.url)) return { label: 'Found in an earlier search', tone: 'info' };
    if (catalogueMatchFor(candidate, catalogueProducts) !== null) return { label: 'Possible catalogue product', tone: 'warn' };
    return { label: 'Unreviewed web page', tone: 'warn' };
  }

  function whyFor(candidate: WebResearchCandidate): string {
    const match = catalogueMatchFor(candidate, catalogueProducts);
    if (match !== null) {
      return `This looks like the reviewed catalogue product ${match.product}. Check it before treating it as the same product.`;
    }
    return 'Matched the query you approved.';
  }

  function actionsFor(candidate: WebResearchCandidate): ResearchCardAction[] {
    const saved = existing.has(candidate.url);
    const addedTitle = added[candidate.url];
    const actions: ResearchCardAction[] = [];
    if (!saved && addedTitle === undefined) {
      actions.push({
        label: 'Save as evidence',
        variant: 'primary',
        disabled: busy,
        testId: 'research-save-as-evidence',
        onClick: () => { select(candidate); },
      });
      actions.push({
        label: 'Use as an option',
        disabled: busy,
        testId: 'research-use-as-option',
        onClick: () => { void addAsOption(candidate); },
      });
    }
    actions.push({ label: 'Open page', href: candidate.url });
    actions.push({
      label: 'Dismiss',
      variant: 'ghost',
      disabled: busy,
      onClick: () => { setDismissed((prev) => [...prev, candidate.url]); },
    });
    return actions;
  }

  function renderCheck() {
    return (
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
              setSelectedUrl(null);
              setAssertion('');
              setChecked(false);
            }}
          >
            Choose another page
          </Button>
        </div>
      </div>
    );
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
              The exact text below is sent to Anthropic&apos;s web search and recorded with the decision. Do not include private model, customer or organisation detail.
            </Text>
            {(chips.length > 0 || suggestion.intent === 'find-products') && (
              <div className={styles.suggestions} data-testid="research-suggestions">
                <Text as="p" size="sm" tone="muted">
                  {suggestion.intent === 'find-products'
                    ? `No product is named yet. This starts as a market scan for products that support ${capabilityLabel}.`
                    : `This starts from ${suggestion.productName ?? 'the named product'}. The search gathers evidence to score it against cost, effort, delivery risk, timing and vendor fit.`}
                </Text>
                {suggestion.productOptions.length > 1 && (
                  <>
                    <label htmlFor={productSelectId}>
                      <Text as="span" size="sm">
                        Which product?
                      </Text>
                    </label>
                    <select
                      id={productSelectId}
                      className={styles.select}
                      value={selectedProduct ?? suggestion.productName ?? ''}
                      disabled={searching}
                      onChange={(event) => { chooseProduct(event.target.value); }}
                    >
                      {suggestion.productOptions.map((product) => (
                        <option key={product} value={product}>{product}</option>
                      ))}
                    </select>
                  </>
                )}
                {chips.length > 0 && (
                  <>
                    <Text as="p" size="xs" tone="muted">
                      Remove any part you do not want to search for.
                    </Text>
                    <div className={styles.chips}>
                      {chips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className={styles.chip}
                          disabled={searching}
                          onClick={() => { removeChip(chip); }}
                          aria-label={`Remove ${chip} from the suggested query`}
                        >
                          {chip} <span aria-hidden="true">×</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
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
                setQueryState(event.target.value);
                setApprovedQuery(null);
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
                  setApprovedQuery(event.target.checked ? query : null);
                  setError(null);
                }}
              />
              <Text as="span" size="sm">
                I approve this exact text for a public web search.
              </Text>
            </label>
            {notice !== null && (
              <div role="status">
                <Text as="p" size="sm">{notice}</Text>
              </div>
            )}
            <div className={styles.actions}>
              <Button variant="primary" disabled={searching || query.trim() === '' || !approved} onClick={() => void runSearch()}>
                {searching ? 'Searching.' : 'Search the web'}
              </Button>
              {(query !== '' || chips.length > 0) && (
                <Button variant="ghost" disabled={busy} onClick={clearSuggestion}>
                  Clear
                </Button>
              )}
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
              What the search returned
            </Text>
            {results.length === 0 ? (
              <Text as="p" size="sm">
                No pages came back. Try a different query.
              </Text>
            ) : visible.length === 0 ? (
              <Text as="p" size="sm">
                No pages are left to look at. Search again or close.
              </Text>
            ) : (
              <div className={styles.results} aria-label="Pages returned by the search">
                {visible.map((candidate) => {
                  const isSelected = selectedUrl === candidate.url && !existing.has(candidate.url) && added[candidate.url] === undefined;
                  return (
                    <ResearchResultCard
                      key={candidate.url}
                      testId="research-result"
                      kind="web"
                      title={candidate.title}
                      source={candidate.publisher === '' ? candidate.url : candidate.publisher}
                      whyMatched={whyFor(candidate)}
                      evidence={candidate.excerpt === null
                        ? [{ text: 'No excerpt was returned. Open the page and read it before saving.' }]
                        : [{ text: `“${candidate.excerpt}”` }]}
                      status={statusFor(candidate)}
                      url={candidate.url}
                      selectable={!existing.has(candidate.url) && added[candidate.url] === undefined}
                      selected={isSelected}
                      onSelect={() => { select(candidate); }}
                      actions={actionsFor(candidate)}
                    >
                      {isSelected && renderCheck()}
                    </ResearchResultCard>
                  );
                })}
              </div>
            )}

            {visible.length > 0 && selected === null && selectable.length > 0 && (
              <Text as="p" size="sm" tone="muted">
                Choose one page to check and save, or use a page as the basis of a new option.
              </Text>
            )}
            <div className={styles.gapBlock} data-testid="research-gap">
              {!gapOpen ? (
                <Button variant="ghost" disabled={busy} onClick={() => { setGapOpen(true); setGapError(null); }} data-testid="research-record-gap">
                  Record what we could not find
                </Button>
              ) : (
                <>
                  <Text as="h3" size="sm">What could you not find?</Text>
                  <Text as="p" size="sm" tone="muted">
                    A short note is saved on this option and shown on the decision. It does not change the model.
                  </Text>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    maxLength={DECISION_GAP_BODY_MAX}
                    value={gapBody}
                    disabled={gapSaving}
                    onChange={(event) => {
                      setGapBody(event.target.value);
                      setGapError(null);
                    }}
                    placeholder="For example: no published source says whether the vendor supports single sign-on."
                  />
                  <Text as="p" size="xs" tone="muted">
                    {gapBody.trim().length}/{DECISION_GAP_BODY_MAX} characters
                  </Text>
                  {gapError !== null && (
                    <div role="alert">
                      <Text as="p" size="sm">{gapError}</Text>
                    </div>
                  )}
                  <div className={styles.actions}>
                    <Button variant="primary" disabled={gapSaving || decisionGapProblem(gapBody) !== null} onClick={() => void saveGap()}>
                      {gapSaving ? 'Saving.' : 'Save what we could not find'}
                    </Button>
                    <Button variant="ghost" disabled={gapSaving} onClick={() => { setGapOpen(false); setGapBody(''); setGapError(null); }}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </div>
            {notice !== null && (
              <div role="status">
                <Text as="p" size="sm">{notice}</Text>
              </div>
            )}
            <div className={styles.actions}>
              <Button variant="ghost" disabled={busy} onClick={backToQuery}>
                Search again
              </Button>
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
