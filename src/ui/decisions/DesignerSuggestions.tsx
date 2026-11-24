import { useEffect, useRef, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { catalogueRefKeyOf, DESIGNER_SUMMARY_MAX, DESIGNER_TITLE_MAX, DESIGNER_WEIGH_MAX, type DesignerCatalogueProduct, type DesignerWebRef } from '../../contracts/designerOptions';
import { runDesigner, type DesignerDraft } from '../../db/designAgent';
import type { AskEvent } from '../../tools/askLoop';
import { DESIGNER_MAX_FINDING_CHARS } from '../../tools/designPrompt';
import { Button } from '../components/Button/Button';
import { loadBrowserEnv } from '../env';
import { useMembership } from '../orgs/useMembership';
import { useMembers } from '../orgs/useMembers';
import { ownerNames as namesOfOwners } from '../orgs/ownerNames';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { ResearchResultCard } from './ResearchResultCard';
import { hostOf } from './researchCatalogueMatches';
import { designerCostLine, designerTrialLine } from './designerRequest';
import { useDesignerTrial } from './useDesignerTrial';
import { clockNow, loadPending, pendingKey, savePending, type PendingOption } from './pendingOptions';
import formStyles from './DecisionsView.module.css';
import styles from './DesignerSuggestions.module.css';

export interface SuggestionCard extends PendingOption {
  /** Carried into the decision when true. */
  included: boolean;
  /** D4: pages the search returned for this option. Shown for review; saving them with the option is the next step. Absent on drafts saved before web search existed. */
  webRefs?: DesignerWebRef[];
}

/** What the form needs to know: the options to carry in, and whether an agent helped. */
export interface SuggestionSelection {
  options: PendingOption[];
  draftedAt: string | null;
  /** A person changed a suggestion before using it. */
  anyEdited: boolean;
}

export interface DesignerSuggestionsProps {
  orgId: UUID;
  userId: UUID;
  modelId: UUID;
  /** The element the Designer is pointed at. */
  elementId: UUID;
  /** The business question as the person has it written right now: what the Designer is sent. */
  brief: string;
  /** Names this form's held draft, so a refresh or a return finds it again. */
  scope: string;
  onChange: (selection: SuggestionSelection) => void;
}

const isEdited = (c: PendingOption) => c.title.trim() !== c.suggestedTitle.trim() || c.summary.trim() !== c.suggestedSummary.trim();

/** The lookup tools, in words a person reading the form already uses. */
const TOOL_LABELS: Record<string, string> = {
  search_elements: 'Searching the model',
  get_element: 'Reading an element',
  list_relationships: 'Checking what links to it',
  find_elements: 'Finding related elements',
  find_catalogue_products: 'Checking reviewed products',
  list_saved_reports: 'Reading saved reports',
  run_saved_report: 'Reading a saved report',
  list_health_findings: 'Reading health findings',
  portfolio_signals: 'Reading portfolio signals',
  list_changes: 'Reading changes in flight',
  change_impact: 'Checking what a change affects',
  list_decisions: 'Reading decisions',
  list_projects: 'Reading projects',
  list_goals: 'Reading goals',
  list_principles: 'Reading principles',
};

const toolLabel = (name: string) => TOOL_LABELS[name] ?? name.replaceAll('_', ' ');

function newCards(draft: DesignerDraft, draftedAt: string): SuggestionCard[] {
  return draft.options.map((o) => ({ id: crypto.randomUUID(), title: o.title, summary: o.summary, toWeigh: o.toWeigh, suggestedTitle: o.title, suggestedSummary: o.summary, draftedAt, catalogueRefs: o.catalogueRefs, catalogueProducts: o.catalogueProducts, webRefs: o.webRefs, included: true }));
}

/** The option a person gets when they pick one reviewed product out of a replacement card. */
function productSuggestion(product: DesignerCatalogueProduct, draftedAt: string): SuggestionCard {
  const title = `Use ${product.product}`.slice(0, DESIGNER_TITLE_MAX);
  const summary = `${product.product} by ${product.vendor}. ${product.howItSupports}`.trim().slice(0, DESIGNER_SUMMARY_MAX);
  return {
    id: crypto.randomUUID(),
    title,
    summary,
    toWeigh: '',
    suggestedTitle: title,
    suggestedSummary: summary,
    draftedAt,
    catalogueRefs: [product.ref],
    catalogueProducts: [product],
    included: true,
  };
}

/**
 * "Suggest options": runs the Designer on the brief the person can see and
 * shows what it suggests as cards they can edit and leave out, then carries the
 * ones they keep into the decision as real options (journey proposal step 2).
 * It writes nothing itself: options are saved when the decision is started.
 * Unsaved suggestions are held in this browser for 24 hours, so a refresh or
 * a visit to another page does not lose them.
 */
export function DesignerSuggestions({ orgId, userId, modelId, elementId, brief, scope, onChange }: DesignerSuggestionsProps) {
  // What a run cost is the organisation owner's business, not every contributor's (Simon, 2026-11-20).
  const { role } = useMembership(orgId, userId);
  const trial = useDesignerTrial(orgId, 'panel');
  const { members } = useMembers(orgId);
  const ownerNames = namesOfOwners(members);
  const [ranOnTrial, setRanOnTrial] = useState(0);
  const onTrial = trial !== null && !trial.keySet;
  const heldKey = pendingKey(orgId, userId, `designer-${scope}`);
  const [state, setState] = useState<'idle' | 'running' | 'failed' | 'stopped'>('idle');
  const [steps, setSteps] = useState<{ name: string; ok: boolean | null }[]>([]);
  const [message, setMessage] = useState('');
  const [cards, setCards] = useState<SuggestionCard[]>([]);
  const [earlier, setEarlier] = useState<SuggestionCard[]>([]);
  const [meta, setMeta] = useState<Omit<Pick<DesignerDraft, 'gaps' | 'stayNote' | 'problems' | 'citedNames' | 'grounded' | 'usage'>, 'usage'> & { usage: DesignerDraft['usage'] & { trial?: boolean } } | null>(null);
  const [held, setHeld] = useState<SuggestionCard[]>(() => loadPending(localStorage, heldKey, clockNow()) as SuggestionCard[]);
  const abort = useRef<AbortController | null>(null);
  const runNo = useRef(0);

  const all = [...cards, ...earlier];
  const included = all.filter((c) => c.included && c.title.trim() !== '' && c.summary.trim() !== '');
  // Only a product-specific option counts as "already an option"; the
  // replacement card that carries the same refs is not itself a product choice.
  const usedCatalogueRefs = new Set(all.filter((card) => /^use\s/i.test(card.title)).flatMap((card) => card.catalogueRefs.map(catalogueRefKeyOf)));

  useEffect(() => {
    onChange({ options: included, draftedAt: included.length > 0 ? (included[0]?.draftedAt ?? null) : null, anyEdited: included.some(isEdited) });
    // `included` is rebuilt every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(included)]);

  useEffect(() => {
    savePending(localStorage, heldKey, all, clockNow());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(all)]);

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const trialLeft = trial === null ? null : Math.max(0, trial.runsLeft - ranOnTrial);
  const trialLine = trial !== null && trialLeft !== null ? designerTrialLine({ keySet: trial.keySet, trial: { runsLeft: trialLeft, runsUsed: trial.runsUsed + ranOnTrial }, ownerNames }) : null;
  const trialSpent = onTrial && trialLeft === 0;
  const briefText = brief.trim();
  const tooLong = briefText.length > DESIGNER_MAX_FINDING_CHARS;

  async function run() {
    const mine = ++runNo.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState('running');
    setMessage('');
    setSteps([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('You need to be signed in to ask the Designer for options.');
      const draft = await runDesigner({
        functionUrl: `${loadBrowserEnv().VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/design-agent`,
        accessToken: session.access_token,
        modelId,
        elementId,
        finding: briefText,
        onEvent: (event: AskEvent) => {
          if (mine !== runNo.current) return;
          setSteps((prev) => {
            const next = prev.slice();
            if (event.type === 'tool_call') next.push({ name: event.name, ok: null });
            else {
              let open = -1;
              next.forEach((step, i) => {
                if (step.name === event.name && step.ok === null) open = i;
              });
              if (open >= 0) next[open] = { name: event.name, ok: event.ok };
            }
            return next;
          });
        },
        signal: controller.signal,
      });
      if (mine !== runNo.current) return;
      setEarlier((prev) => [...cards, ...prev]);
      setCards(newCards(draft, new Date().toISOString()));
      setMeta({ gaps: draft.gaps, stayNote: draft.stayNote, problems: draft.problems, citedNames: draft.citedNames, grounded: draft.grounded, usage: { ...draft.usage, trial: onTrial } });
      setState('idle');
      if (onTrial) setRanOnTrial((n) => n + 1);
    } catch (e) {
      if (mine !== runNo.current) return;
      setMessage(e instanceof Error ? e.message : 'The Designer could not suggest options. Try again.');
      setState('failed');
    }
  }

  function stop() {
    runNo.current += 1;
    abort.current?.abort();
    setState('stopped');
  }

  function update(id: UUID, patch: Partial<SuggestionCard>) {
    const apply = (list: SuggestionCard[]) => list.map((c) => (c.id === id ? { ...c, ...patch } : c));
    setCards(apply);
    setEarlier(apply);
  }

  function addProductOption(product: DesignerCatalogueProduct): void {
    setCards((prev) => [productSuggestion(product, new Date().toISOString()), ...prev]);
  }

  function renderProduct(product: DesignerCatalogueProduct) {
    const key = catalogueRefKeyOf(product.ref);
    const used = usedCatalogueRefs.has(key);
    return (
      <ResearchResultCard
        key={key}
        testId="designer-catalogue-product"
        kind="catalogue"
        title={product.product}
        source={product.vendor}
        whyMatched={product.howItSupports === ''
          ? (product.capabilityName === '' ? 'Supports the capability this option concerns.' : `Supports ${product.capabilityName}.`)
          : `Supports ${product.capabilityName === '' ? 'this capability' : product.capabilityName}: ${product.howItSupports}`}
        evidence={product.claims.slice(0, 3).map((claim) => ({ text: claim.statement, sourceUrl: claim.sourceUrl, sourceDate: claim.sourceDate }))}
        status={{ label: 'Reviewed catalogue product', tone: 'ok' }}
        actions={[{
          label: used ? 'Already an option' : 'Use this product',
          variant: 'secondary',
          disabled: used,
          testId: 'designer-use-product',
          onClick: () => { addProductOption(product); },
        }]}
      />
    );
  }

  function renderCard(c: SuggestionCard) {
    const edited = isEdited(c);
    return (
      <li key={c.id} className={[styles.card, c.included ? undefined : styles.cardLeftOut].filter(Boolean).join(' ')} data-testid="suggestion-card">
        <div className={styles.cardHead}>
          <Chip tone="info">{edited ? 'Suggested by the Designer, edited by you' : 'Suggested by the Designer'}</Chip>
          <label className={styles.include}>
            <input type="checkbox" checked={c.included} onChange={(e) => { update(c.id, { included: e.target.checked }); }} />
            <Text as="span" size="sm">{c.included ? 'Include' : 'Left out'}</Text>
          </label>
        </div>
        <input className={formStyles.input} type="text" aria-label="Option title" maxLength={DESIGNER_TITLE_MAX} value={c.title} onChange={(e) => { update(c.id, { title: e.target.value }); }} />
        <textarea className={formStyles.textarea} aria-label="What this option is" maxLength={DESIGNER_SUMMARY_MAX} value={c.summary} onChange={(e) => { update(c.id, { summary: e.target.value }); }} />
        <textarea className={formStyles.textarea} aria-label="What to weigh" placeholder="What to weigh" maxLength={DESIGNER_WEIGH_MAX} value={c.toWeigh} onChange={(e) => { update(c.id, { toWeigh: e.target.value }); }} />
        {(c.catalogueProducts ?? []).length > 0 && (
          <div data-testid="suggestion-catalogue-products" className={styles.evidenceBlock}>
            <Text as="p" size="xs" tone="muted">
              Reviewed catalogue products the Designer read for this option. They are candidates, not a recommendation.
            </Text>
            <div className={styles.productList}>
              {(c.catalogueProducts ?? []).map((product) => renderProduct(product))}
            </div>
          </div>
        )}
        {(c.webRefs ?? []).length > 0 && (
          <div data-testid="suggestion-web-sources" className={styles.evidenceBlock}>
            <Text as="p" size="xs" tone="muted">Web pages found for this option. They are not saved yet and are not reviewed; check them yourself.</Text>
            <div className={styles.productList}>
              {(c.webRefs ?? []).map((ref) => (
                <ResearchResultCard
                  key={ref.url}
                  kind="web"
                  title={ref.title}
                  source={hostOf(ref.url) || ref.url}
                  whyMatched="Found by an earlier web search for this option."
                  status={{ label: 'Unreviewed web page', tone: 'warn' }}
                  url={ref.url}
                  actions={[{ label: 'Open page', href: ref.url }]}
                />
              ))}
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className={styles.panel} data-testid="designer-panel">
      {held.length > 0 && all.length === 0 && (
        <div className={styles.restore} role="status" data-testid="designer-restore">
          <Text as="span" size="sm">You have {held.length === 1 ? 'one unsaved suggestion' : `${String(held.length)} unsaved suggestions`} from earlier. Nothing was lost.</Text>
          <Button type="button" variant="secondary" onClick={() => { setCards(held); setHeld([]); }}>Restore them</Button>
          <Button type="button" variant="secondary" onClick={() => { savePending(localStorage, heldKey, [], clockNow()); setHeld([]); }}>Discard them</Button>
        </div>
      )}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={state === 'running' || briefText === '' || tooLong || trialSpent} onClick={() => { void run(); }}>
          {state === 'running' ? 'Suggesting options…' : cards.length > 0 || earlier.length > 0 ? 'Suggest again' : 'Suggest options'}
        </Button>
        {state === 'running' && (
          <Button type="button" variant="secondary" onClick={stop}>
            Cancel
          </Button>
        )}
      </div>
      {state === 'running' && (
        <div role="status" data-testid="designer-progress">
          {steps.length === 0 ? (
            <Text as="p" tone="muted" size="sm">Reading what Atlas holds about this. You can keep editing what you have written while it works.</Text>
          ) : (
            <>
              <Text as="p" tone="muted" size="sm">
                {steps.every((step) => step.ok !== null) ? 'Drafting options from what it found…' : 'Looking things up…'}
              </Text>
              <ul className={styles.steps}>
                {steps.map((step, i) => (
                  <li key={`${step.name}-${String(i)}`}>
                    <Text as="span" size="xs" tone="muted">
                      {toolLabel(step.name)}{step.ok === null ? '…' : step.ok ? ' ✓' : ' — nothing found'}
                    </Text>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {trialLine !== null && (
        <div role="status" data-testid="designer-trial-line">
          <Text as="p" size="sm">{trialLine}</Text>
        </div>
      )}
      {state !== 'running' && (
        <Text as="p" tone="muted" size="sm">
          {briefText === ''
            ? 'Write what the options need to solve above, then ask for suggestions.'
            : tooLong
              ? `Shorten what you have written to ${String(DESIGNER_MAX_FINDING_CHARS)} characters or fewer to ask for suggestions (it is ${String(briefText.length)} now).`
              : 'The Designer reads what you have written above and what Atlas holds, and suggests a short set of options. They are drafts for you to edit. Nothing is saved until you start the decision, and staying as we are is always added for you.'}
        </Text>
      )}
      {state === 'stopped' && <div role="status"><Text as="p" size="sm">Stopped. Nothing was added. The AI service may still finish on its side.</Text></div>}
      {state === 'failed' && (
        <div role="alert">
          <Text as="p">{message} Your brief and anything you edited are kept. You can try again or add options by hand after you start the decision.</Text>
        </div>
      )}
      {meta !== null && meta.problems.length > 0 && (
        <div role="alert" data-testid="designer-incomplete">
          <Text as="p"><strong>This draft may be incomplete.</strong> {meta.problems.join(' ')} Check it before you rely on it, or suggest again.</Text>
        </div>
      )}
      {cards.length > 0 && (
        <ul className={styles.cards} aria-label="Suggested options">
          {cards.map(renderCard)}
        </ul>
      )}
      {meta !== null && meta.stayNote !== '' && (
        <Text as="p" size="sm">
          <strong>Staying as we are</strong> is always included. The Designer's note: {meta.stayNote}
        </Text>
      )}
      {meta !== null && meta.gaps.length > 0 && (
        <div>
          <Text as="p" size="sm"><strong>What the Designer could not tell</strong></Text>
          <ul>
            {meta.gaps.map((g) => (
              <li key={g}><Text as="span" size="sm">{g}</Text></li>
            ))}
          </ul>
        </div>
      )}
      {earlier.length > 0 && (
        <details className={styles.fold} data-testid="earlier-suggestions">
          <summary>Earlier suggestions ({earlier.length})</summary>
          <ul className={styles.cards} aria-label="Earlier suggested options">
            {earlier.map(renderCard)}
          </ul>
        </details>
      )}
      {meta !== null && (
        <>
          <Text as="p" tone="muted" size="sm">{meta.grounded ? `Based on: ${meta.citedNames.join(', ')}.` : 'Not tied to specific records Atlas holds, so check it carefully.'}</Text>
          {role === 'owner' && (
            <div data-testid="designer-cost">
              <Text as="p" tone="muted" size="sm">{designerCostLine(meta.usage)}</Text>
            </div>
          )}
        </>
      )}
      {all.length > 0 && (
        <div data-testid="designer-selection">
        <Text as="p" size="sm">
          {included.length === 0 ? 'No suggestions are included. The decision will start with only staying as we are.' : `${String(included.length)} ${included.length === 1 ? 'suggestion' : 'suggestions'} will be added as options when you start the decision. They stay editable there.`}
        </Text>
        </div>
      )}
    </div>
  );
}
