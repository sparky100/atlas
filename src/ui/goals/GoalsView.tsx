import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { GOAL_LIMITS, type GoalInput } from '../../contracts/goals';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Loading } from '../components/Loading/Loading';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { countText, linkableCapabilities, orderGoals, summariseGoals, type GoalSummary } from './goalModel';
import { useGoals } from './useGoals';
import styles from './GoalsView.module.css';

export interface GoalsViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** `goals_insert`/`_update`'s floor — owner or architect. The forms and buttons are omitted, not disabled, when false. */
  canEdit: boolean;
}

const EMPTY: GoalInput = { title: '', statement: '', whyNow: '' };

/**
 * ADR-035: the Goals page. What the organisation is trying to achieve, each
 * with the capabilities that serve it and how many systems support each.
 * Counts are plain numbers, never a score.
 */
export function GoalsView({ modelId, orgId, userId, orgSlug, modelSlug, canEdit }: GoalsViewProps) {
  const { loading, goals, links, capabilities, supportsEdges, error, saving, create, edit, setStatus, link, unlink } = useGoals(modelId, orgId, userId);
  const [draft, setDraft] = useState<GoalInput>(EMPTY);
  const [editingId, setEditingId] = useState<UUID | null>(null);
  const [editDraft, setEditDraft] = useState<GoalInput>(EMPTY);

  const summaries = summariseGoals(orderGoals(goals), links, capabilities, supportsEdges);
  const active = summaries.filter((s) => s.goal.status === 'active');
  const retired = summaries.filter((s) => s.goal.status === 'retired');
  const capabilityHref = (id: string) => `/o/${orgSlug}/m/${modelSlug}/e/${id}`;

  const renderCard = (s: GoalSummary) => (
    <GoalCard
      key={s.goal.id}
      summary={s}
      options={linkableCapabilities(capabilities, new Set(s.capabilities.map((c) => c.capabilityId)))}
      capabilityHref={capabilityHref}
      canEdit={canEdit}
      saving={saving}
      editing={editingId === s.goal.id}
      editDraft={editDraft}
      error={editingId === s.goal.id ? error : null}
      onEditDraft={setEditDraft}
      onStartEdit={() => {
        setEditingId(s.goal.id);
        setEditDraft({ title: s.goal.title, statement: s.goal.statement, whyNow: s.goal.why_now });
      }}
      onCancelEdit={() => {
        setEditingId(null);
      }}
      onSave={() => {
        void edit(s.goal.id, editDraft).then((ok) => {
          if (ok) setEditingId(null);
        });
      }}
      onStatus={(status) => {
        void setStatus(s.goal.id, status);
      }}
      onLink={(capabilityId) => {
        void link(s.goal.id, capabilityId);
      }}
      onUnlink={(capabilityId) => {
        void unlink(s.goal.id, capabilityId);
      }}
    />
  );

  return (
    <div>
      {canEdit && (
        <Panel>
          <Text as="h2" size="lg">
            Add a goal
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void create(draft).then((ok) => {
                if (ok) setDraft(EMPTY);
              });
            }}
          >
            <GoalFields value={draft} onChange={setDraft} idPrefix="new-goal" />
            <div className={styles.actions}>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add goal'}
              </Button>
            </div>
          </form>
          {error !== null && editingId === null && <Text as="p">{error}</Text>}
        </Panel>
      )}

      {loading && <Loading />}
      {!loading && goals.length === 0 && <EmptyState>No goals yet. {canEdit ? 'Add the first one above.' : 'An owner or architect can add them.'}</EmptyState>}

      {active.length > 0 && (
        <section className={styles.group} aria-label="Active goals">
          <div className={styles.groupHeading}>
            <Text as="h2" size="lg">
              Active
            </Text>
            <Text as="span" tone="muted" size="sm">
              ({active.length})
            </Text>
          </div>
          <ul className={styles.list}>{active.map(renderCard)}</ul>
        </section>
      )}

      {retired.length > 0 && (
        <section className={styles.group} aria-label="Retired goals">
          <div className={styles.groupHeading}>
            <Text as="h2" size="lg">
              Retired
            </Text>
            <Text as="span" tone="muted" size="sm">
              ({retired.length})
            </Text>
          </div>
          <ul className={styles.list}>{retired.map(renderCard)}</ul>
        </section>
      )}
    </div>
  );
}

function GoalFields({ value, onChange, idPrefix }: { value: GoalInput; onChange: (next: GoalInput) => void; idPrefix: string }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-title`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            Title
          </Text>
        </label>
        <input id={`${idPrefix}-title`} className={styles.input} type="text" maxLength={GOAL_LIMITS.title} placeholder="e.g. Cut the time to connect a new customer" value={value.title} onChange={(e) => { onChange({ ...value, title: e.target.value }); }} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-statement`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            What success looks like
          </Text>
        </label>
        <textarea id={`${idPrefix}-statement`} className={styles.textarea} maxLength={GOAL_LIMITS.statement} placeholder="One or two plain sentences" value={value.statement} onChange={(e) => { onChange({ ...value, statement: e.target.value }); }} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-why-now`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            Why now (optional)
          </Text>
        </label>
        <textarea id={`${idPrefix}-why-now`} className={styles.textarea} maxLength={GOAL_LIMITS.whyNow} placeholder="A regulation, a merger, a contract ending" value={value.whyNow} onChange={(e) => { onChange({ ...value, whyNow: e.target.value }); }} />
      </div>
    </>
  );
}

interface GoalCardProps {
  summary: GoalSummary;
  options: { id: string; name: string }[];
  capabilityHref: (capabilityId: string) => string;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  editDraft: GoalInput;
  error: string | null;
  onEditDraft: (next: GoalInput) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onStatus: (status: 'active' | 'retired') => void;
  onLink: (capabilityId: string) => void;
  onUnlink: (capabilityId: string) => void;
}

function GoalCard({ summary, options, capabilityHref, canEdit, saving, editing, editDraft, error, onEditDraft, onStartEdit, onCancelEdit, onSave, onStatus, onLink, onUnlink }: GoalCardProps) {
  const { goal, capabilities, missing, unsupported } = summary;
  const retired = goal.status === 'retired';
  const [pick, setPick] = useState('');
  return (
    <li className={styles.card}>
      {editing ? (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <GoalFields value={editDraft} onChange={onEditDraft} idPrefix={`edit-${goal.id}`} />
          <div className={styles.actions}>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" type="button" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
          {error !== null && <Text as="p">{error}</Text>}
        </form>
      ) : (
        <>
          <div className={styles.cardHead}>
            <Text as="h3" size="lg" className={styles.title}>
              {goal.title}
            </Text>
            {retired && <Chip tone="neutral">Retired</Chip>}
          </div>
          <Text as="p">{goal.statement}</Text>
          {goal.why_now !== '' && (
            <Text as="p" tone="muted" size="sm">
              Why now: {goal.why_now}
            </Text>
          )}
          <Text as="p" size="sm" tone="muted">
            Served by {countText(capabilities.length, 'capability', 'capabilities')}
            {unsupported > 0 ? `. ${countText(unsupported, 'has', 'have')} no supporting system.` : '.'}
            {missing > 0 ? ` ${countText(missing, 'linked capability is', 'linked capabilities are')} no longer in the model.` : ''}
          </Text>
          {capabilities.length > 0 && (
            <ul className={styles.uses} aria-label={`Capabilities that serve ${goal.title}`}>
              {capabilities.map((c) => (
                <li key={c.capabilityId}>
                  <span className={styles.capRow}>
                    <Link to={capabilityHref(c.capabilityId)}>{c.name}</Link>
                    <Text as="span" size="sm" tone="muted">
                      {countText(c.supporters, 'supporting system', 'supporting systems')}
                    </Text>
                    {canEdit && !retired && (
                      <Button variant="ghost" type="button" disabled={saving} onClick={() => { onUnlink(c.capabilityId); }} aria-label={`Remove ${c.name} from ${goal.title}`}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit && !retired && options.length > 0 && (
            <div className={styles.picker}>
              <label htmlFor={`pick-${goal.id}`}>
                <Text as="span" size="sm" tone="muted">
                  Add a capability
                </Text>
              </label>
              <select id={`pick-${goal.id}`} className={styles.select} value={pick} onChange={(e) => { setPick(e.target.value); }}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                type="button"
                disabled={saving || pick === ''}
                onClick={() => {
                  onLink(pick);
                  setPick('');
                }}
                aria-label={`Add the chosen capability to ${goal.title}`}
              >
                Add
              </Button>
            </div>
          )}
          {error !== null && <Text as="p">{error}</Text>}
          {canEdit && (
            <div className={styles.actions}>
              {!retired && (
                <Button variant="secondary" type="button" onClick={onStartEdit} aria-label={`Edit ${goal.title}`}>
                  Edit
                </Button>
              )}
              {retired ? (
                <Button variant="secondary" type="button" disabled={saving} onClick={() => { onStatus('active'); }} aria-label={`Make ${goal.title} active again`}>
                  Make active again
                </Button>
              ) : (
                <Button variant="ghost" type="button" disabled={saving} onClick={() => { onStatus('retired'); }} aria-label={`Retire ${goal.title}`}>
                  Retire
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
