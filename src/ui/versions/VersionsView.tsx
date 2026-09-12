import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { LinkButton } from '../components/Button/LinkButton';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import type { TagRow } from '../../db/types';
import { formatDateTime } from '../time';
import { useVersions } from './useVersions';
import styles from './VersionsView.module.css';

export interface VersionsViewProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  orgSlug: string;
  modelSlug: string;
  /** Owner/architect only (§4.2-style gate, ADR-015) — omitted entirely, not shown disabled, otherwise. */
  canTag: boolean;
}

const MAIN_OPTION = 'main';

/**
 * "Version list; open any version read-only; diff two versions" (Sprint
 * U2 step 4). Opening a version is just a link with `?ref=tag:<name>` —
 * every view already built in this sprint (element page, capability map,
 * landscape, context/container/component) takes that ref param and
 * renders read-only at it (there is no `Edit`/tailoring affordance for
 * anything but `ref: main`, per every gate this sprint has used). Diffing
 * is the one genuinely new comparison UI: two refs picked here become
 * `?ref=&diff=` on src/ui/routes/VersionDiffPage.tsx.
 */
export function VersionsView({ modelId, orgId, userId, orgSlug, modelSlug, canTag }: VersionsViewProps) {
  const { status, tags, error, mainHeadCommitId, createVersion } = useVersions(modelId, orgId, userId);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [toBeChoice, setToBeChoice] = useState(MAIN_OPTION);
  const [asIsChoice, setAsIsChoice] = useState(MAIN_OPTION);

  const refOptions = [{ value: MAIN_OPTION, label: 'main (current)' }, ...tags.map((tag) => ({ value: `tag:${tag.name}`, label: tag.name }))];
  const diffHref = `/o/${orgSlug}/m/${modelSlug}/diff?${new URLSearchParams({ ref: toBeChoice, diff: asIsChoice }).toString()}`;
  const canCompare = toBeChoice !== asIsChoice;

  return (
    <div>
      {canTag && (
        <Panel>
          <Text as="h2" size="lg">
            Tag main
          </Text>
          <form
            className={styles.tagForm}
            onSubmit={(e) => {
              e.preventDefault();
              void createVersion(name, note).then(() => {
                setName('');
                setNote('');
              });
            }}
          >
            <input className={styles.input} type="text" placeholder="Version name (e.g. v2026-Q2)" value={name} onChange={(e) => { setName(e.target.value); }} disabled={!mainHeadCommitId} />
            <input className={styles.input} type="text" placeholder="Note (optional)" value={note} onChange={(e) => { setNote(e.target.value); }} disabled={!mainHeadCommitId} />
            <Button variant="primary" type="submit" disabled={status === 'tagging' || !mainHeadCommitId}>
              {status === 'tagging' ? 'Tagging…' : 'Tag main now'}
            </Button>
          </form>
          {!mainHeadCommitId && (
            <Text as="p" tone="muted" size="sm">
              This model has no commits yet — there is nothing to tag.
            </Text>
          )}
          {error !== null && (
            <Text as="p" tone="default">
              {error}
            </Text>
          )}
        </Panel>
      )}

      {refOptions.length > 1 && (
        <Panel>
          <Text as="h2" size="lg">
            Compare two versions
          </Text>
          <div className={styles.compareForm}>
            <select className={styles.select} value={toBeChoice} onChange={(e) => { setToBeChoice(e.target.value); }}>
              {refOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Text as="span" tone="muted">
              vs
            </Text>
            <select className={styles.select} value={asIsChoice} onChange={(e) => { setAsIsChoice(e.target.value); }}>
              {refOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {canCompare ? (
              <LinkButton to={diffHref} variant="secondary">
                Diff →
              </LinkButton>
            ) : (
              <Button variant="secondary" disabled>
                Diff →
              </Button>
            )}
          </div>
        </Panel>
      )}

      <Text as="h2" size="lg">
        Versions
      </Text>
      {status === 'loading' && <Text tone="muted">Loading…</Text>}
      {tags.length === 0 && status !== 'loading' && <EmptyState>No versions tagged yet.</EmptyState>}
      {tags.length > 0 && (
        <ul className={styles.list}>
          {tags.map((tag) => (
            <VersionRow key={tag.id} tag={tag} orgSlug={orgSlug} modelSlug={modelSlug} />
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionRow({ tag, orgSlug, modelSlug }: { tag: TagRow; orgSlug: string; modelSlug: string }) {
  return (
    <li className={styles.row}>
      <div>
        <Text as="span" size="lg">
          {tag.name}
        </Text>
        {tag.description !== null && (
          <Text as="p" tone="muted" size="sm">
            {tag.description}
          </Text>
        )}
        <Text as="p" tone="faint" size="xs">
          {formatDateTime(tag.created_at)}
        </Text>
      </div>
      <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/capability-map?ref=tag:${tag.name}`} variant="secondary">
        Open →
      </LinkButton>
    </li>
  );
}
