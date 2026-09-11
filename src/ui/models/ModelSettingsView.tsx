import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { TypedNameConfirm } from '../components/TypedNameConfirm/TypedNameConfirm';
import type { ModelRow, MemberRole } from '../../db/types';
import { canArchiveModel, canDeleteModel, canRestoreModel } from '../orgs/roleGates';
import { useModelSettings } from './useModelSettings';
import styles from './ModelSettingsView.module.css';

export interface ModelSettingsViewProps {
  model: ModelRow;
  role: MemberRole | null;
  orgId: UUID;
  orgSlug: string;
  onChanged: (model: ModelRow) => void;
}

/**
 * Sprint 7j item 1: model settings — rename/slug/description, Archive/
 * Restore, Delete (owner only, only when archived, typed-name
 * confirmation). Read-only when the model is archived, per the prompt's
 * own wording — only Restore and Delete remain live then.
 */
export function ModelSettingsView({ model, role, orgSlug, onChanged }: ModelSettingsViewProps) {
  const { status, error, update, archive, restore, remove } = useModelSettings(model.id, onChanged);
  const [name, setName] = useState(model.name);
  const [slug, setSlug] = useState(model.slug);
  const [description, setDescription] = useState(model.description ?? '');
  const [deleteResult, setDeleteResult] = useState<'not_archived' | 'not_found' | null>(null);
  const navigate = useNavigate();
  const isArchived = model.archived_at !== null;
  const canEdit = canArchiveModel(role) && !isArchived;
  // Real label/input association (`htmlFor`/`id`), the same
  // `AttributeEditRow.tsx`'s own pattern already uses — a sibling `Text
  // as="label"` with no `for` reads fine visually but isn't programmatically
  // associated with anything, which breaks both screen readers and
  // `getByLabel`-driven tests.
  const nameId = useId();
  const slugId = useId();
  const descriptionId = useId();

  return (
    <div>
      <Panel>
        <Text as="h2" size="lg">
          Model
        </Text>
        {isArchived && (
          <div className={styles.archivedNotice}>
            <Chip tone="neutral">Archived</Chip>
            <Text as="p" tone="muted" size="sm">
              Read-only while archived. Hidden from the model list.
            </Text>
          </div>
        )}
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void update({ name, slug, description: description.trim().length > 0 ? description.trim() : null });
          }}
        >
          <label htmlFor={nameId}>
            <Text as="span" size="sm">
              Name
            </Text>
          </label>
          <input
            id={nameId}
            className={styles.input}
            type="text"
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <label htmlFor={slugId}>
            <Text as="span" size="sm">
              Slug
            </Text>
          </label>
          <input
            id={slugId}
            className={styles.input}
            type="text"
            value={slug}
            disabled={!canEdit}
            onChange={(e) => {
              setSlug(e.target.value);
            }}
          />
          <label htmlFor={descriptionId}>
            <Text as="span" size="sm">
              Description
            </Text>
          </label>
          <textarea
            id={descriptionId}
            className={styles.textarea}
            value={description}
            disabled={!canEdit}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
          {canEdit && (
            <Button variant="primary" type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form>
        {error !== null && <Text as="p">{error}</Text>}
      </Panel>

      {canArchiveModel(role) && (
        <Panel>
          <Text as="h2" size="lg">
            {isArchived ? 'Restore' : 'Archive'}
          </Text>
          {!isArchived && (
            <>
              <Text as="p" tone="muted" size="sm">
                Hides this model from lists and search. Nothing is deleted — reopening the direct link still works, read-only, and any owner can restore it.
              </Text>
              <Button
                variant="secondary"
                disabled={status === 'saving'}
                onClick={() => {
                  void archive();
                }}
              >
                Archive model
              </Button>
            </>
          )}
          {isArchived && canRestoreModel(role) && (
            <Button
              variant="secondary"
              disabled={status === 'saving'}
              onClick={() => {
                void restore();
              }}
            >
              Restore model
            </Button>
          )}
          {isArchived && !canRestoreModel(role) && (
            <Text as="p" tone="muted" size="sm">
              Only an owner can restore an archived model.
            </Text>
          )}
        </Panel>
      )}

      {canDeleteModel(role) && isArchived && (
        <Panel>
          <Text as="h2" size="lg">
            Delete
          </Text>
          <Text as="p" tone="muted" size="sm">
            Permanently deletes this model and everything in it — every commit, delta, comment and version. This cannot be undone.
          </Text>
          <TypedNameConfirm
            requiredName={model.name}
            actionLabel="Delete model"
            disabled={status === 'saving'}
            onConfirm={() => {
              void remove().then((result) => {
                if (!result) return;
                if (result.status === 'deleted') {
                  void navigate(`/o/${orgSlug}`);
                } else {
                  setDeleteResult(result.status);
                }
              });
            }}
          />
          {deleteResult === 'not_archived' && <Text as="p">Archive this model first.</Text>}
          {deleteResult === 'not_found' && <Text as="p">This model no longer exists.</Text>}
        </Panel>
      )}
    </div>
  );
}
