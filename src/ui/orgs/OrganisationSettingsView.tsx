import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { TypedNameConfirm } from '../components/TypedNameConfirm/TypedNameConfirm';
import type { MemberRole, OrganisationRow } from '../../db/types';
import { canManageOrgSettings } from './roleGates';
import { useMembers } from './useMembers';
import { useOrganisationSettings } from './useOrganisationSettings';
import styles from './OrganisationSettingsView.module.css';

const ROLE_OPTIONS: MemberRole[] = ['owner', 'architect', 'contributor', 'viewer'];

export interface OrganisationSettingsViewProps {
  organisation: OrganisationRow;
  role: MemberRole | null;
  userId: UUID | null;
  onChanged: (organisation: OrganisationRow) => void;
}

/**
 * Sprint 7j item 2: organisation settings — rename/slug, the member
 * directory (profile, role, joined date, role change, remove), and Delete
 * organisation (owner only, typed-name confirmation, only actually
 * possible while the organisation has no models — `atlas.delete_organisation`'s
 * own precondition, surfaced here as a structured result rather than
 * guessed at client-side). Read-only for a non-owner: the route resolves
 * for any member, same "controls gate individually, not the whole page"
 * shape `ModelSettingsView.tsx` already uses.
 */
export function OrganisationSettingsView({ organisation, role, userId, onChanged }: OrganisationSettingsViewProps) {
  const canManage = canManageOrgSettings(role);
  const { status, error, update, remove } = useOrganisationSettings(organisation.id, onChanged);
  const { members, loading: membersLoading, error: membersError, changeRole, remove: removeMemberRow } = useMembers(organisation.id);
  const [name, setName] = useState(organisation.name);
  const [slug, setSlug] = useState(organisation.slug);
  const [deleteResult, setDeleteResult] = useState<'has_models' | 'not_found' | null>(null);
  const [deleteModelCount, setDeleteModelCount] = useState(0);
  const navigate = useNavigate();
  // Real label/input association (`htmlFor`/`id`) — `ModelSettingsView.tsx`'s
  // own fix for the same issue (a sibling `Text as="label"` with no `for`
  // isn't programmatically associated with anything).
  const nameId = useId();
  const slugId = useId();

  return (
    <div>
      <Panel>
        <Text as="h2" size="lg">
          Organisation
        </Text>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void update({ name, slug });
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
            disabled={!canManage}
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
            disabled={!canManage}
            onChange={(e) => {
              setSlug(e.target.value);
            }}
          />
          {canManage && (
            <Button variant="primary" type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form>
        {error !== null && <Text as="p">{error}</Text>}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Members
        </Text>
        {membersError !== null && <Text as="p">{membersError}</Text>}
        {!membersLoading && members.length === 0 && <EmptyState>No members.</EmptyState>}
        {members.length > 0 && (
          <ul className={styles.memberList}>
            {members.map(({ member, profile }) => {
              const label = profile?.display_name ?? (profile !== null ? `@${profile.handle}` : 'Unknown member');
              return (
                <li key={member.user_id} className={styles.memberRow}>
                  <div className={styles.memberIdentity}>
                    <Text as="span">
                      {label}
                      {member.user_id === userId ? ' (you)' : ''}
                    </Text>
                    {profile?.display_name != null && (
                      <Text as="span" tone="muted" size="sm">
                        @{profile.handle}
                      </Text>
                    )}
                    <Text as="span" tone="muted" size="sm">
                      Joined {new Date(member.joined_at).toLocaleDateString()}
                    </Text>
                  </div>
                  {canManage ? (
                    <div className={styles.memberActions}>
                      <select
                        className={styles.roleSelect}
                        aria-label={`Role for ${label}`}
                        value={member.role}
                        onChange={(e) => {
                          void changeRole(member.user_id, e.target.value as MemberRole);
                        }}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${label}`}
                        onClick={() => {
                          void removeMemberRow(member.user_id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <Chip tone="neutral">{member.role}</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {canManage && (
        <Panel>
          <Text as="h2" size="lg">
            Delete
          </Text>
          <Text as="p" tone="muted" size="sm">
            Permanently deletes this organisation. Only possible while it has no models. This cannot be undone.
          </Text>
          <TypedNameConfirm
            requiredName={organisation.name}
            actionLabel="Delete organisation"
            disabled={status === 'saving'}
            onConfirm={() => {
              void remove().then((result) => {
                if (!result) return;
                if (result.status === 'deleted') {
                  void navigate('/');
                } else if (result.status === 'has_models') {
                  setDeleteModelCount(result.count);
                  setDeleteResult('has_models');
                } else {
                  setDeleteResult('not_found');
                }
              });
            }}
          />
          {deleteResult === 'has_models' && (
            <Text as="p">
              This organisation still has {deleteModelCount} model{deleteModelCount === 1 ? '' : 's'}. Archive or delete {deleteModelCount === 1 ? 'it' : 'them all'} first.
            </Text>
          )}
          {deleteResult === 'not_found' && <Text as="p">This organisation no longer exists.</Text>}
        </Panel>
      )}
    </div>
  );
}
