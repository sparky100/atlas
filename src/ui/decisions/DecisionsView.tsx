import { Loading } from '../components/Loading/Loading';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CollapsibleSection } from '../components/CollapsibleSection/CollapsibleSection';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useMainBranch } from '../branches/useMainBranch';
import { useMembers } from '../orgs/useMembers';
import { profileLabel } from '../comments/profileLabel';
import type { DecisionRow } from '../../db/types';
import type { DecisionPrefill } from './decisionPrefill';
import { DecisionLinkPicker } from './DecisionLinkPicker';
import { DesignerSuggestions, type SuggestionSelection } from './DesignerSuggestions';
import { clockNow, pendingKey, savePending } from './pendingOptions';
import { designerInputFromPrefill } from './designerRequest';
import { groupDecisionsList } from './decisionsListGroups';
import { decisionStatusLabel, decisionStatusTone } from './decisionStatus';
import { useDecisions } from './useDecisions';
import styles from './DecisionsView.module.css';

export interface DecisionsViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** Same floor as `canCreateChangeBranch` (F3's own resolved decision — see `docs/ADR-022-decisions-schema.md`) — omitted entirely, not shown disabled, when false. */
  canCreate: boolean;
  /** Prompt pack F3 PR6: "Start a decision" from a health finding or a weak-capability tile — `null` for the ordinary bare `/decisions` visit, which opens the form blank exactly as before this PR. */
  prefill: DecisionPrefill | null;
  /** Phase D: true only for an owner or architect in an organisation with Ask Atlas on, agents on and an AI key saved. Absent means the Designer is not offered. */
  designerAvailable?: boolean;
  /** Why the Designer is not offered, shown only when a finding is behind the form and it could have been. */
  designerUnavailable?: { text: string; canFix: boolean } | null;
}

/**
 * Prompt pack F3's "Decisions" list — create + list (PR4), reads a
 * `prefill` (PR6's "Start a decision" from a health finding or a weak-
 * capability tile) to open the form already filled in rather than blank.
 * Mirrors `ChangesView.tsx`'s own shape: a create form gated by role,
 * loading/empty states, a list of rows linking onward.
 */
export function DecisionsView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate, prefill, designerAvailable = false, designerUnavailable = null }: DecisionsViewProps) {
  const navigate = useNavigate();
  const { status, decisions, error, createDecisionWithLinks } = useDecisions(modelId, orgId, userId);
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  // Lazy initializers, not an effect: `prefill` is read once, from the URL
  // this page landed on — a person is free to edit any of these fields
  // afterwards without them snapping back, and a later re-render (e.g. the
  // owner `<select>` populating once `members` loads) never overwrites a
  // title/statement/link the person already touched.
  const [title, setTitle] = useState(() => prefill?.title ?? '');
  const [statement, setStatement] = useState(() => prefill?.statement ?? '');
  // Set when the Designer's draft is put into the context, so the decision says an agent helped (Simon, 2026-11-19). Editing the context afterwards marks it edited.
  const [suggested, setSuggested] = useState<SuggestionSelection>({ options: [], draftedAt: null, anyEdited: false });
  const aiDraft = suggested.draftedAt !== null ? { draftedAt: suggested.draftedAt, edited: suggested.anyEdited } : null;
  const [ownerId, setOwnerId] = useState(userId ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [links, setLinks] = useState<{ elementId: UUID; name: string }[]>(() =>
    prefill ? prefill.linkedElements.map((el) => ({ elementId: el.id, name: el.name })) : [],
  );

  // The Designer is pointed at the first thing the decision is about: the finding behind the form, or whatever the person has linked.
  const designerElementId = designerInputFromPrefill(prefill)?.elementId ?? links[0]?.elementId;

  const resetForm = () => {
    setTitle('');
    setStatement('');
    setSuggested({ options: [], draftedAt: null, anyEdited: false });
    setOwnerId(userId ?? '');
    setNeededBy('');
    setLinks([]);
  };

  return (
    <div>
      {canCreate && (
        <Panel>
          <Text as="h2" size="lg">
            Start a decision
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (!ownerId) return;
              void createDecisionWithLinks({
                title,
                statement,
                ownerId,
                neededBy,
                // An empty key is the element page's own "Start a decision…" (no finding behind it).
                ...(prefill && prefill.sourceFindingKey !== '' ? { sourceFindingKey: prefill.sourceFindingKey } : {}),
                ...(aiDraft !== null ? { aiDraft: { agent: 'designer' as const, draftedAt: aiDraft.draftedAt, edited: aiDraft.edited } } : {}),
                links: links.map((l) => ({ linkedType: 'element' as const, linkedId: l.elementId })),
              }).then((decision) => {
                if (decision) {
                  // The options the person kept are saved on the decision page as it opens, one by one, so a failure there can be retried without losing them.
                  if (suggested.options.length > 0 && userId) savePending(localStorage, pendingKey(orgId, userId, decision.id), suggested.options, clockNow());
                  resetForm();
                  void navigate(`/o/${orgSlug}/m/${modelSlug}/decisions/${decision.id}`);
                }
              });
            }}
          >
            <input
              className={styles.input}
              type="text"
              placeholder="Title (e.g. What replaces SAP PM?)"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
            <label>
              <Text as="span" size="sm">
                What the options need to solve
              </Text>
              <textarea
                className={styles.textarea}
                placeholder="Context — why this decision needs making"
                value={statement}
                onChange={(e) => {
                  setStatement(e.target.value);
                }}
              />
            </label>
            {!designerAvailable && designerUnavailable !== null && (
              <div data-testid="designer-unavailable">
                <Text as="p" tone="muted" size="sm">
                  {designerUnavailable.text}{' '}
                  {designerUnavailable.canFix && <Link to={`/o/${orgSlug}/settings`}>Open organisation settings</Link>}
                </Text>
              </div>
            )}
            {designerAvailable && userId && designerElementId !== undefined && (
              <DesignerSuggestions orgId={orgId} userId={userId} modelId={modelId} elementId={designerElementId} brief={statement.trim() !== '' ? statement : title} scope={`decisions-${modelId}`} onChange={setSuggested} />
            )}
            {designerAvailable && designerElementId === undefined && (
              <Text as="p" tone="muted" size="sm" data-testid="designer-needs-link">
                To get suggested options, say below what this decision is about (a system or capability).
              </Text>
            )}
            <div className={styles.formRow}>
              <Text as="label" size="sm" tone="muted">
                Owner
              </Text>
              <select
                className={styles.select}
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                }}
              >
                <option value="">Choose an owner…</option>
                {members.map((m) => (
                  <option key={m.member.user_id} value={m.member.user_id}>
                    {profileLabel(m.profile)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <Text as="label" size="sm" tone="muted">
                Needed by
              </Text>
              <input
                className={styles.input}
                type="date"
                value={neededBy}
                onChange={(e) => {
                  setNeededBy(e.target.value);
                }}
              />
            </div>
            {main?.head_commit_id && (
              <DecisionLinkPicker
                commitId={main.head_commit_id}
                modelId={modelId}
                selected={links}
                onAdd={(elementId, name) => {
                  setLinks((prev) => [...prev, { elementId, name }]);
                }}
                onRemove={(elementId) => {
                  setLinks((prev) => prev.filter((l) => l.elementId !== elementId));
                }}
              />
            )}
            <Button variant="primary" type="submit" disabled={status === 'creating' || !ownerId || title.trim().length === 0}>
              {status === 'creating' ? 'Starting…' : suggested.options.length > 0 ? `Start decision with ${String(suggested.options.length)} suggested ${suggested.options.length === 1 ? 'option' : 'options'}` : 'Start decision'}
            </Button>
          </form>
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      <Text as="h2" size="lg">
        Decisions
      </Text>
      {status === 'loading' && <Loading />}
      {decisions.length === 0 && status !== 'loading' && <EmptyState>No decisions yet. {canCreate ? 'Start one above.' : 'Nobody has started one.'}</EmptyState>}
      {groupDecisionsList(decisions).map((section) => (
        <CollapsibleSection key={section.key} title={section.title} meta={`(${String(section.decisions.length)})`} defaultOpen={section.defaultOpen}>
          <ul className={styles.list}>
            {section.decisions.map((decision) => (
              <DecisionRowItem key={decision.id} decision={decision} orgSlug={orgSlug} modelSlug={modelSlug} />
            ))}
          </ul>
        </CollapsibleSection>
      ))}
    </div>
  );
}

function DecisionRowItem({ decision, orgSlug, modelSlug }: { decision: DecisionRow; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {decision.title}
        </Text>
        {decision.statement !== '' && (
          <Text as="p" tone="muted" size="sm">
            {decision.statement}
          </Text>
        )}
        <div className={styles.rowMeta}>
          <Chip tone={decisionStatusTone(decision.status)}>{decisionStatusLabel(decision.status)}</Chip>
          {decision.needed_by !== null && (
            <Text as="span" tone="faint" size="xs">
              Needed by: {decision.needed_by}
            </Text>
          )}
        </div>
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/decisions/${decision.id}`} variant="secondary">
        Open →
      </LinkButton>
    </li>
  );
}
