import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { PRINCIPLE_LIMITS, type PrincipleInput } from '../../contracts/principles';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Loading } from '../components/Loading/Loading';
import { SidePanel } from '../components/SidePanel/SidePanel';
import { Text } from '../components/Text/Text';
import { countText, orderPrinciples, summarisePrinciples, type PrincipleSummary } from './principleModel';
import { PrincipleSetsPanel } from './PrincipleSetsPanel';
import { usePrinciples } from './usePrinciples';
import styles from './PrinciplesView.module.css';

export interface PrinciplesViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** `principles_insert`/`_update`'s floor — owner or architect. The forms and buttons are omitted, not disabled, when false. */
  canEdit: boolean;
}

const EMPTY: PrincipleInput = { title: '', statement: '', why: '' };

/**
 * ADR-034: the Principles page. The rules the team agrees decisions are
 * checked against, each with the decisions that follow it and the ones that
 * depart from it (and why). Counts are plain numbers, never a score.
 */
export function PrinciplesView({ modelId, orgId, userId, orgSlug, modelSlug, canEdit }: PrinciplesViewProps) {
  const { loading, principles, links, decisions, error, saving, create, edit, setStatus, reload } = usePrinciples(modelId, orgId, userId);
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [draft, setDraft] = useState<PrincipleInput>(EMPTY);
  const [editingId, setEditingId] = useState<UUID | null>(null);
  const [editDraft, setEditDraft] = useState<PrincipleInput>(EMPTY);

  const summaries = summarisePrinciples(orderPrinciples(principles), links, decisions);
  const active = summaries.filter((s) => s.principle.status === 'active');
  const retired = summaries.filter((s) => s.principle.status === 'retired');
  const decisionHref = (id: string) => `/o/${orgSlug}/m/${modelSlug}/decisions/${id}`;

  return (
    <div>
      <div className={styles.toolbar}>
        {canEdit && (
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add principle
          </Button>
        )}
        <PrincipleSetsPanel modelId={modelId} orgId={orgId} userId={userId} canEdit={canEdit} onChanged={reload} />
      </div>

      {canEdit && adding && (
        <SidePanel
          title="Add a principle"
          onClose={() => {
            setAdding(false);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void create(draft).then((ok) => {
                if (ok) {
                  setDraft(EMPTY);
                  setAdding(false);
                }
              });
            }}
          >
            <PrincipleFields value={draft} onChange={setDraft} idPrefix="new-principle" />
            <div className={styles.actions}>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add principle'}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setAdding(false);
                }}
              >
                Cancel
              </Button>
            </div>
            {error !== null && editingId === null && <Text as="p">{error}</Text>}
          </form>
        </SidePanel>
      )}

      {loading && <Loading />}
      {!loading && principles.length === 0 && <EmptyState>No principles yet. {canEdit ? 'Choose Add principle above to write the first one.' : 'An owner or architect can add them.'}</EmptyState>}

      {active.length > 0 && (
        <section className={styles.group} aria-label="Active principles">
          <div className={styles.groupHeading}>
            <Text as="h2" size="lg">
              Active
            </Text>
            <Text as="span" tone="muted" size="sm">
              ({active.length})
            </Text>
          </div>
          <ul className={styles.list}>
            {active.map((s) => (
              <PrincipleCard
                key={s.principle.id}
                summary={s}
                decisionHref={decisionHref}
                canEdit={canEdit}
                saving={saving}
                editing={editingId === s.principle.id}
                editDraft={editDraft}
                error={editingId === s.principle.id ? error : null}
                onEditDraft={setEditDraft}
                onStartEdit={() => {
                  setEditingId(s.principle.id);
                  setEditDraft({ title: s.principle.title, statement: s.principle.statement, why: s.principle.why });
                }}
                onCancelEdit={() => {
                  setEditingId(null);
                }}
                onSave={() => {
                  void edit(s.principle.id, editDraft).then((ok) => {
                    if (ok) setEditingId(null);
                  });
                }}
                onStatus={(status) => {
                  void setStatus(s.principle.id, status);
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {retired.length > 0 && (
        <section className={styles.group} aria-label="Retired principles">
          <div className={styles.groupHeading}>
            <Text as="h2" size="lg">
              Retired
            </Text>
            <Text as="span" tone="muted" size="sm">
              ({retired.length})
            </Text>
            <Button
              variant="ghost"
              type="button"
              aria-expanded={showRetired}
              onClick={() => {
                setShowRetired(!showRetired);
              }}
            >
              {showRetired ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showRetired && (
          <ul className={styles.list}>
            {retired.map((s) => (
              <PrincipleCard
                key={s.principle.id}
                summary={s}
                decisionHref={decisionHref}
                canEdit={canEdit}
                saving={saving}
                editing={false}
                editDraft={editDraft}
                error={null}
                onEditDraft={setEditDraft}
                onStartEdit={() => undefined}
                onCancelEdit={() => undefined}
                onSave={() => undefined}
                onStatus={(status) => {
                  void setStatus(s.principle.id, status);
                }}
              />
            ))}
          </ul>
          )}
        </section>
      )}
    </div>
  );
}

function PrincipleFields({ value, onChange, idPrefix }: { value: PrincipleInput; onChange: (next: PrincipleInput) => void; idPrefix: string }) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-title`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            Title
          </Text>
        </label>
        <input id={`${idPrefix}-title`} className={styles.input} type="text" maxLength={PRINCIPLE_LIMITS.title} placeholder="e.g. Every system has a named owner" value={value.title} onChange={(e) => { onChange({ ...value, title: e.target.value }); }} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-statement`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            The rule
          </Text>
        </label>
        <textarea id={`${idPrefix}-statement`} className={styles.textarea} maxLength={PRINCIPLE_LIMITS.statement} placeholder="One or two plain sentences a decision can be checked against" value={value.statement} onChange={(e) => { onChange({ ...value, statement: e.target.value }); }} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-why`} className={styles.fieldLabel}>
          <Text as="span" size="sm" tone="muted">
            Why (optional)
          </Text>
        </label>
        <textarea id={`${idPrefix}-why`} className={styles.textarea} maxLength={PRINCIPLE_LIMITS.why} placeholder="Why a team would accept it" value={value.why} onChange={(e) => { onChange({ ...value, why: e.target.value }); }} />
      </div>
    </>
  );
}

interface PrincipleCardProps {
  summary: PrincipleSummary;
  decisionHref: (decisionId: string) => string;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  editDraft: PrincipleInput;
  error: string | null;
  onEditDraft: (next: PrincipleInput) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onStatus: (status: 'active' | 'retired') => void;
}

function PrincipleCard({ summary, decisionHref, canEdit, saving, editing, editDraft, error, onEditDraft, onStartEdit, onCancelEdit, onSave, onStatus }: PrincipleCardProps) {
  const { principle, followed, departed } = summary;
  const retired = principle.status === 'retired';
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
          <PrincipleFields value={editDraft} onChange={onEditDraft} idPrefix={`edit-${principle.id}`} />
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
              {principle.title}
            </Text>
            {retired && <Chip tone="neutral">Retired</Chip>}
          </div>
          <Text as="p">{principle.statement}</Text>
          {principle.why !== '' && (
            <Text as="p" tone="muted" size="sm">
              Why: {principle.why}
            </Text>
          )}
          {principle.from_set_name !== null && principle.from_set_version !== null && (
            <Text as="p" size="sm" tone="muted">
              Started from the {principle.from_set_name} set, version {principle.from_set_version}. It is yours now: reword it as you like.
            </Text>
          )}
          <Text as="p" size="sm" tone="muted">
            Followed by {countText(followed.length, 'decision', 'decisions')}. Departed from by {countText(departed.length, 'decision', 'decisions')}.
          </Text>
          {followed.length > 0 && (
            <ul className={styles.uses} aria-label={`Decisions that follow ${principle.title}`}>
              {followed.map((d) => (
                <li key={d.decisionId}>
                  <Link to={decisionHref(d.decisionId)}>{d.title}</Link>
                </li>
              ))}
            </ul>
          )}
          {departed.length > 0 && (
            <ul className={styles.uses} aria-label={`Decisions that depart from ${principle.title}`}>
              {departed.map((d) => (
                <li key={d.decisionId}>
                  <Link to={decisionHref(d.decisionId)}>{d.title}</Link>
                  <Text as="span" size="sm" tone="muted">
                    {' '}
                    — departs: {d.reason}
                  </Text>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className={styles.actions}>
              {!retired && (
                <Button variant="secondary" type="button" onClick={onStartEdit} aria-label={`Edit ${principle.title}`}>
                  Edit
                </Button>
              )}
              {retired ? (
                <Button variant="secondary" type="button" disabled={saving} onClick={() => { onStatus('active'); }} aria-label={`Make ${principle.title} active again`}>
                  Make active again
                </Button>
              ) : (
                <Button variant="ghost" type="button" disabled={saving} onClick={() => { onStatus('retired'); }} aria-label={`Retire ${principle.title}`}>
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
