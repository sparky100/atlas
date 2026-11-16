import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { useAuth } from '../auth/useAuth';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { TypedNameConfirm } from '../components/TypedNameConfirm/TypedNameConfirm';
import type { ModelRow, MemberRole } from '../../db/types';
import { defaultCopyName, slugForCopy } from '../../db/copyModel';
import { canArchiveModel, canCopyModel, canDeleteModel, canRestoreModel } from '../orgs/roleGates';
import { usePlatformAdmin } from '../admin/usePlatformAdmin';
import { useCopyModel } from './useCopyModel';
import { useModels } from './useModels';
import { useModelSettings } from './useModelSettings';
import { useModelSharing } from './useModelSharing';
import { usePublishSampleModel } from './usePublishSampleModel';
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
export function ModelSettingsView({ model, role, orgId, orgSlug, onChanged }: ModelSettingsViewProps) {
  const { userId } = useAuth();
  const { status, error, update, archive, restore, remove } = useModelSettings(model.id, onChanged);
  const canShare = canDeleteModel(role);
  const sharing = useModelSharing(canShare ? model.id : null, userId);
  const [name, setName] = useState(model.name);
  const [slug, setSlug] = useState(model.slug);
  const [description, setDescription] = useState(model.description ?? '');
  const [deleteResult, setDeleteResult] = useState<'not_archived' | 'not_found' | null>(null);
  const canCopy = canCopyModel(role);
  const { models: orgModels } = useModels(canCopy ? orgId : null);
  const copying = useCopyModel(model, userId);
  const { isPlatformAdmin } = usePlatformAdmin(userId);
  const publishing = usePublishSampleModel(model, userId);
  const [sampleSlug, setSampleSlug] = useState(model.slug);
  const sampleSlugId = useId();
  const [copyName, setCopyName] = useState<string | null>(null);
  const copyNameId = useId();
  const [targetOrgSlug, setTargetOrgSlug] = useState('');
  const [targetTagId, setTargetTagId] = useState('');
  const [shareResult, setShareResult] = useState<'org_not_found' | 'already_shared' | null>(null);
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
  const targetOrgSlugId = useId();
  const tagSelectId = useId();

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

      {canCopy && (
        <Panel>
          <Text as="h2" size="lg">
            Copy this model
          </Text>
          <Text as="p" tone="muted" size="sm">
            Makes a new, separate model in this organisation from how this one stands today: every element and relationship, who said what and how sure they were, names and codes, and the organisation's shared reports and dashboards. It starts with a single "Copied from {model.name}" entry in History. Earlier history, open changes, decisions, projects, comments, private reports and shares are not copied. This model is not touched.
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              const name = (copyName ?? defaultCopyName(model.name, orgModels.map((m) => m.name))).trim();
              if (name.length === 0) return;
              void copying.copy(name, slugForCopy(name, orgModels.map((m) => m.slug)));
            }}
          >
            <label htmlFor={copyNameId}>
              <Text as="span" size="sm">
                Name of the copy
              </Text>
            </label>
            <input
              id={copyNameId}
              className={styles.input}
              type="text"
              value={copyName ?? defaultCopyName(model.name, orgModels.map((m) => m.name))}
              onChange={(e) => {
                setCopyName(e.target.value);
              }}
            />
            <Button variant="primary" type="submit" disabled={copying.status === 'copying'}>
              {copying.status === 'copying' ? 'Copying…' : 'Copy model'}
            </Button>
          </form>
          {copying.error !== null && <Text as="p">{copying.error}</Text>}
          {copying.copied !== null && (
            <Text as="p">
              Copied {copying.copied.elements} elements and {copying.copied.relationships} relationships. <Link to={`/o/${orgSlug}/m/${copying.copied.model.slug}/start`}>Open {copying.copied.model.name}</Link>
            </Text>
          )}
        </Panel>
      )}

      {isPlatformAdmin && (
        <Panel>
          <Text as="h2" size="lg">
            Publish as a sample model
          </Text>
          <Text as="p" tone="muted" size="sm">
            Platform admins only. Makes how this model stands today available to every organisation as a "Start with a sample model" choice on an empty model list. Each publish is a new version; people who already added an earlier one keep their own copy. Names of people and links out are left out. Make sure nothing in this model is private.
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void publishing.publish(sampleSlug);
            }}
          >
            <label htmlFor={sampleSlugId}>
              <Text as="span" size="sm">
                Short name (lowercase letters, numbers and hyphens)
              </Text>
            </label>
            <input
              id={sampleSlugId}
              className={styles.input}
              type="text"
              value={sampleSlug}
              onChange={(e) => {
                setSampleSlug(e.target.value);
              }}
            />
            <Button variant="primary" type="submit" disabled={publishing.status === 'publishing'}>
              {publishing.status === 'publishing' ? 'Publishing…' : 'Publish sample'}
            </Button>
          </form>
          {publishing.error !== null && <Text as="p">{publishing.error}</Text>}
          {publishing.published !== null && (
            <Text as="p">
              Published version {publishing.published.version} with {publishing.published.elements} elements and {publishing.published.relationships} relationships.
            </Text>
          )}
        </Panel>
      )}

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
            Permanently deletes this model and everything in it — every edit, comment and version. This cannot be undone.
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

      {canShare && (
        <Panel>
          <Text as="h2" size="lg">
            Share with another organisation
          </Text>
          <Text as="p" tone="muted" size="sm">
            Grants read-only access to this model's current main, or to one specific tagged version — never edit access, and never visible to the other organisation unless you share it here.
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              setShareResult(null);
              void sharing.create(targetOrgSlug.trim(), targetTagId.length > 0 ? targetTagId : null).then((result) => {
                if (!result) return;
                if (result.status === 'created') {
                  setTargetOrgSlug('');
                  setTargetTagId('');
                } else {
                  setShareResult(result.status);
                }
              });
            }}
          >
            <label htmlFor={targetOrgSlugId}>
              <Text as="span" size="sm">
                Organisation slug
              </Text>
            </label>
            <input
              id={targetOrgSlugId}
              className={styles.input}
              type="text"
              value={targetOrgSlug}
              onChange={(e) => {
                setTargetOrgSlug(e.target.value);
              }}
            />
            <label htmlFor={tagSelectId}>
              <Text as="span" size="sm">
                Version
              </Text>
            </label>
            <select
              id={tagSelectId}
              className={styles.input}
              value={targetTagId}
              onChange={(e) => {
                setTargetTagId(e.target.value);
              }}
            >
              <option value="">Live model</option>
              {sharing.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
            <Button variant="primary" type="submit" disabled={targetOrgSlug.trim().length === 0}>
              Share
            </Button>
          </form>
          {shareResult === 'org_not_found' && <Text as="p">No organisation found for that slug.</Text>}
          {shareResult === 'already_shared' && <Text as="p">Already shared with that organisation at this version.</Text>}
          {sharing.error !== null && <Text as="p">{sharing.error}</Text>}

          {sharing.shares.length > 0 && (
            <ul className={styles.shareList}>
              {sharing.shares.map((share) => (
                <li key={share.id} className={styles.shareRow}>
                  <Text as="span">{sharing.orgNames.get(share.shared_with_org_id) ?? share.shared_with_org_id}</Text>
                  <Chip tone="neutral">{share.tag_id ? (sharing.tags.find((t) => t.id === share.tag_id)?.name ?? 'tagged version') : 'live model'}</Chip>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      void sharing.revoke(share.id);
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
