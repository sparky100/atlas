import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { LinkButton } from '../components/Button/LinkButton';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useMainBranch } from '../branches/useMainBranch';
import { useMembers } from '../orgs/useMembers';
import { profileLabel } from '../comments/profileLabel';
import type { DecisionRow } from '../../db/types';
import { DecisionLinkPicker } from './DecisionLinkPicker';
import { decisionStatusTone } from './decisionStatus';
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
}

/**
 * Prompt pack F3 PR4's "Decisions" list — create + list only (no options/
 * compare/choose yet, PR5; no "Start a decision" pre-fill or "why is this
 * here" yet, PR6). Mirrors `ChangesView.tsx`'s own shape: a create form
 * gated by role, loading/empty states, a list of rows linking onward.
 */
export function DecisionsView({ modelId, orgId, userId, orgSlug, modelSlug, canCreate }: DecisionsViewProps) {
  const navigate = useNavigate();
  const { status, decisions, error, createDecisionWithLinks } = useDecisions(modelId, orgId, userId);
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [ownerId, setOwnerId] = useState(userId ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [links, setLinks] = useState<{ elementId: UUID; name: string }[]>([]);

  const resetForm = () => {
    setTitle('');
    setStatement('');
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
                links: links.map((l) => ({ linkedType: 'element' as const, linkedId: l.elementId })),
              }).then((decision) => {
                if (decision) {
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
            <textarea
              className={styles.textarea}
              placeholder="Context — why this decision needs making"
              value={statement}
              onChange={(e) => {
                setStatement(e.target.value);
              }}
            />
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
              {status === 'creating' ? 'Starting…' : 'Start decision'}
            </Button>
          </form>
          {error !== null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      <Text as="h2" size="lg">
        Decisions
      </Text>
      {status === 'loading' && <Text tone="muted">Loading…</Text>}
      {decisions.length === 0 && status !== 'loading' && <EmptyState>No decisions yet. {canCreate ? 'Start one above.' : 'Nobody has started one.'}</EmptyState>}
      {decisions.length > 0 && (
        <ul className={styles.list}>
          {decisions.map((decision) => (
            <DecisionRowItem key={decision.id} decision={decision} orgSlug={orgSlug} modelSlug={modelSlug} />
          ))}
        </ul>
      )}
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
          <Chip tone={decisionStatusTone(decision.status)}>{decision.status}</Chip>
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
