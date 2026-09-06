import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link } from 'react-router';
import type { ModelRow } from '../../../db/types';
import { Button } from '../Button/Button';
import { Panel } from '../Panel/Panel';
import { Text } from '../Text/Text';
import styles from './ModelList.module.css';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ModelListProps {
  orgSlug: string;
  models: ModelRow[];
  loading: boolean;
  /** Only rendered when the caller can actually create a model (owner/architect) — roles enforced in UI, mirroring the RLS policy that's the real gate. */
  canCreate: boolean;
  onCreate: (name: string, slug: string) => Promise<void>;
}

export function ModelList({ orgSlug, models, loading, canCreate, onCreate }: ModelListProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onCreate(name.trim(), slugify(name));
      setName('');
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create model');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Text tone="muted">Loading models…</Text>;
  }

  return (
    <div>
      {models.length === 0 && !creating && (
        <Panel>
          <Text as="p" tone="muted">
            {canCreate ? 'No models yet. A model is one landscape — create the first one to get started.' : 'No models yet in this organisation.'}
          </Text>
        </Panel>
      )}
      {models.length > 0 && (
        <ul className={styles.list}>
          {models.map((model) => (
            <li key={model.id}>
              <Link className={styles.row} to={`/o/${orgSlug}/m/${model.slug}`}>
                <Text as="span" size="lg">
                  {model.name}
                </Text>
                {model.description !== null && (
                  <Text as="span" tone="muted">
                    {model.description}
                  </Text>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <div className={styles.createArea}>
          {creating ? (
            <form className={styles.createForm} onSubmit={(e) => void handleSubmit(e)}>
              <input
                className={styles.input}
                placeholder="Model name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
              <Button type="submit" variant="primary" disabled={submitting || name.trim().length === 0}>
                Create
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              {error !== null && (
                <Text tone="default" as="span" className={styles.error}>
                  {error}
                </Text>
              )}
            </form>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(true);
              }}
            >
              New model
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
