import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { PRINCIPLE_SET_LIMITS } from '../../contracts/principleSet';
import { usePlatformAdmin } from '../admin/usePlatformAdmin';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { usePrincipleSets } from './usePrincipleSets';
import styles from './PrinciplesView.module.css';

export interface PrincipleSetsPanelProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** Owner or architect: the floor of `principles_insert`. */
  canEdit: boolean;
  /** Called after principles were added, so the page reads its list again. */
  onChanged: () => void;
}

/**
 * ADR-034 "Starter sets". Owners and architects can start from a published set:
 * open it, tick the principles they want (none are ticked for them) and add
 * them as their own. A platform admin can also publish this model's active
 * principles as the next version of a set. Row-level security is the real gate.
 */
export function PrincipleSetsPanel({ modelId, orgId, userId, canEdit, onChanged }: PrincipleSetsPanelProps) {
  const { isPlatformAdmin } = usePlatformAdmin(userId);
  const { loading, sets, opened, busy, message, open, close, add, publish } = usePrincipleSets(modelId, orgId, userId, onChanged);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const showStart = canEdit && sets.length > 0;
  if (loading || (!showStart && !isPlatformAdmin)) return null;

  const toggle = (index: number) => {
    const next = new Set(ticked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setTicked(next);
  };

  return (
    <>
      {showStart && (
        <Panel>
          <Text as="h2" size="lg">
            Start from a set
          </Text>
          <Text as="p" tone="muted" size="sm">
            A set is a ready-made list of principles. Pick one, tick the principles you want, and they are added to your list as your own to reword or retire. Nothing is added unless you tick it.
          </Text>
          {opened === null ? (
            <ul className={styles.list}>
              {sets.map((set) => (
                <li key={set.id} className={styles.card}>
                  <Text as="h3" size="lg">
                    {set.name}
                  </Text>
                  {set.description !== null && <Text as="p">{set.description}</Text>}
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setTicked(new Set());
                        void open(set);
                      }}
                      aria-label={`Look at ${set.name}`}
                    >
                      Look at this set
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void add([...ticked].sort((a, b) => a - b)).then((ok) => {
                  if (ok) setTicked(new Set());
                });
              }}
            >
              <Text as="h3" size="lg">
                {opened.set.name}
              </Text>
              <ul className={styles.list}>
                {opened.payload.principles.map((principle, index) => (
                  <li key={principle.title} className={styles.card}>
                    <label className={styles.pick}>
                      <input
                        type="checkbox"
                        checked={ticked.has(index)}
                        onChange={() => {
                          toggle(index);
                        }}
                      />
                      <Text as="span" size="lg">
                        {principle.title}
                      </Text>
                    </label>
                    <Text as="p">{principle.statement}</Text>
                    {principle.why !== '' && (
                      <Text as="p" tone="muted" size="sm">
                        Why: {principle.why}
                      </Text>
                    )}
                  </li>
                ))}
              </ul>
              <div className={styles.actions}>
                <Button variant="primary" type="submit" disabled={busy || ticked.size === 0}>
                  {busy ? 'Adding…' : `Add ${String(ticked.size)} ticked`}
                </Button>
                <Button variant="ghost" type="button" disabled={busy} onClick={close}>
                  Back to the sets
                </Button>
              </div>
            </form>
          )}
        </Panel>
      )}

      {isPlatformAdmin && (
        <Panel>
          <Text as="h2" size="lg">
            Publish as a set
          </Text>
          <Text as="p" tone="muted" size="sm">
            Platform admins only. Makes this model's active principles available to every organisation as a starter set. Each publish is a new version; organisations that already added from an earlier one keep their own copies. Make sure nothing in these principles is private to your organisation.
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void publish({ slug, name, description });
            }}
          >
            <div>
              <label htmlFor="set-name" className={styles.fieldLabel}>
                <Text as="span" size="sm" tone="muted">
                  Name of the set
                </Text>
              </label>
              <input id="set-name" className={styles.input} type="text" maxLength={PRINCIPLE_SET_LIMITS.name} value={name} onChange={(e) => { setName(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="set-slug" className={styles.fieldLabel}>
                <Text as="span" size="sm" tone="muted">
                  Short name (lowercase letters, numbers and hyphens)
                </Text>
              </label>
              <input id="set-slug" className={styles.input} type="text" maxLength={PRINCIPLE_SET_LIMITS.slug} value={slug} onChange={(e) => { setSlug(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="set-description" className={styles.fieldLabel}>
                <Text as="span" size="sm" tone="muted">
                  What the set is for (optional)
                </Text>
              </label>
              <textarea id="set-description" className={styles.textarea} maxLength={PRINCIPLE_SET_LIMITS.description} value={description} onChange={(e) => { setDescription(e.target.value); }} />
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" type="submit" disabled={busy}>
                {busy ? 'Publishing…' : 'Publish set'}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {message !== null && (
        <div role="status">
          <Text as="p">{message}</Text>
        </div>
      )}
    </>
  );
}
