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
import { formatDate, formatRelativeTime } from '../time';
import { AttributeDefinitionsPanel } from './AttributeDefinitionsPanel';
import { EntraSignInPanel } from './EntraSignInPanel';
import { memberEventSentence } from './memberEventFormat';
import { canManageOrgSettings } from './roleGates';
import { useInvites } from './useInvites';
import { useMemberEvents } from './useMemberEvents';
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
  const { status, error, update, remove, updateReviewPeriod } = useOrganisationSettings(organisation.id, onChanged);
  const { members, loading: membersLoading, error: membersError, changeRole, remove: removeMemberRow } = useMembers(organisation.id);
  const { invites, loading: invitesLoading, error: invitesError, create: createInviteRow, revoke: revokeInviteRow, resend: resendInviteRow } = useInvites(organisation.id, userId);
  const { events: memberEvents, profilesById: memberEventProfiles, loading: memberEventsLoading, error: memberEventsError } = useMemberEvents(canManage ? organisation.id : null);
  const [name, setName] = useState(organisation.name);
  const [slug, setSlug] = useState(organisation.slug);
  const [reviewDays, setReviewDays] = useState(organisation.review_period_days);
  const canSetReviewPeriod = role === 'owner' || role === 'architect';
  const [minArchitects, setMinArchitects] = useState(organisation.review_min_required_architects);
  const [deleteResult, setDeleteResult] = useState<'has_models' | 'not_found' | null>(null);
  const [deleteModelCount, setDeleteModelCount] = useState(0);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('contributor');
  const [inviteResult, setInviteResult] = useState<'already_pending' | 'created_email_failed' | null>(null);
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  // Sprint F7 item 1: per-invite resend feedback — a plain map, not lifted
  // into `useInvites` itself, since it's transient per-click UI state
  // (same "own this in the component, not the hook" shape `inviteResult`
  // above already uses for create).
  const [resendStatusByInviteId, setResendStatusByInviteId] = useState<Record<UUID, 'sending' | 'sent' | 'error'>>({});
  const navigate = useNavigate();
  // Real label/input association (`htmlFor`/`id`) — `ModelSettingsView.tsx`'s
  // own fix for the same issue (a sibling `Text as="label"` with no `for`
  // isn't programmatically associated with anything).
  const nameId = useId();
  const slugId = useId();
  const minArchitectsId = useId();
  const inviteEmailId = useId();
  const inviteRoleId = useId();
  const askHeadingId = useId();
  const reviewPeriodId = useId();
  const reviewHeadingId = useId();

  return (
    <div>
      <Panel>
        <Text as="h2" size="lg">
          Organisation
        </Text>
        {organisation.is_personal && <Chip tone="neutral">Personal</Chip>}
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void update({ name, slug, reviewMinRequiredArchitects: minArchitects });
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
          <label htmlFor={minArchitectsId}>
            <Text as="span" size="sm">
              Minimum required architects
            </Text>
          </label>
          <input
            id={minArchitectsId}
            className={styles.input}
            type="number"
            min={0}
            value={minArchitects}
            disabled={!canManage}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              setMinArchitects(Number.isNaN(parsed) ? 0 : parsed);
            }}
          />
          <Text as="span" tone="muted" size="sm">
            The fewest architect approvals a change review must have before it can merge.
          </Text>
          {canManage && (
            <Button variant="primary" type="submit" disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          )}
        </form>
        <section aria-labelledby={reviewHeadingId}>
          <Text as="h3" size="md" id={reviewHeadingId}>
            Review reminders
          </Text>
          <Text as="p" tone="muted" size="sm">
            How long a reviewer has to respond once a change is submitted for review. After that the review is marked overdue, on the review itself and on Home, and the person who submitted it, an owner or an architect can send the reviewers one reminder email.
          </Text>
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void updateReviewPeriod(reviewDays);
            }}
          >
            <label htmlFor={reviewPeriodId}>
              <Text as="span" size="sm">
                Days to review
              </Text>
            </label>
            <input
              id={reviewPeriodId}
              className={styles.input}
              type="number"
              min={1}
              max={90}
              value={reviewDays}
              disabled={!canSetReviewPeriod}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                setReviewDays(Number.isNaN(parsed) ? 1 : parsed);
              }}
            />
            {canSetReviewPeriod ? (
              <Button variant="primary" type="submit" disabled={status === 'saving' || reviewDays < 1 || reviewDays > 90}>
                {status === 'saving' ? 'Saving…' : 'Save'}
              </Button>
            ) : (
              <Text as="p" tone="muted" size="sm">
                Only an owner or architect can change this.
              </Text>
            )}
          </form>
        </section>
        <section aria-labelledby={askHeadingId}>
          <Text as="h3" size="md" id={askHeadingId}>
            Ask Atlas
          </Text>
          <Text as="p" tone="muted" size="sm">
            When Ask Atlas is on, the questions members ask, and the names, descriptions, attributes and relationships of the elements needed to answer them, are sent to our AI provider to produce each answer. Comments and unreviewed imports are not sent. It also covers AI apps that members connect to Atlas on their own computer (such as Claude Desktop): while it is off, those apps get no model content. Nothing is sent while it is off.
          </Text>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={organisation.ai_assistant_enabled}
              disabled={!canManage || status === 'saving'}
              onChange={(e) => {
                void update({ aiAssistantEnabled: e.target.checked });
              }}
            />
            <Text as="span" size="sm">
              Allow Ask Atlas for this organisation
            </Text>
          </label>
          {!canManage && (
            <Text as="p" tone="muted" size="sm">
              Only an owner can change this.
            </Text>
          )}
        </section>
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
                      Joined {formatDate(member.joined_at)}
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
                        variant="destructive"
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
            Invite by email
          </Text>
          <Text as="p" tone="muted" size="sm">
            No email is sent. The invited address joins with the chosen role the moment they sign up or next sign in.
          </Text>
          <form
            className={styles.inviteForm}
            onSubmit={(e) => {
              e.preventDefault();
              setInviteResult(null);
              setInviteEmailError(null);
              void createInviteRow(inviteEmail, inviteRole).then((result) => {
                if (!result) return;
                if (result.status === 'already_pending') {
                  setInviteResult('already_pending');
                } else if (result.status === 'created_email_failed') {
                  setInviteResult('created_email_failed');
                  setInviteEmailError(result.emailError);
                  setInviteEmail('');
                } else {
                  setInviteEmail('');
                }
              });
            }}
          >
            <label htmlFor={inviteEmailId}>
              <Text as="span" size="sm">
                Email
              </Text>
            </label>
            <input
              id={inviteEmailId}
              className={styles.input}
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
              }}
            />
            <label htmlFor={inviteRoleId}>
              <Text as="span" size="sm">
                Role
              </Text>
            </label>
            <select
              id={inviteRoleId}
              className={styles.roleSelect}
              value={inviteRole}
              onChange={(e) => {
                setInviteRole(e.target.value as MemberRole);
              }}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button variant="primary" type="submit">
              Send invite
            </Button>
          </form>
          {inviteResult === 'already_pending' && <Text as="p">There's already a pending invite for that email at this organisation.</Text>}
          {inviteResult === 'created_email_failed' && <Text as="p">The invite was created, but the email couldn't be sent{inviteEmailError ? `: ${inviteEmailError}` : '.'} You can resend it below.</Text>}
          {invitesError !== null && <Text as="p">{invitesError}</Text>}
          {!invitesLoading && invites.length === 0 && <EmptyState>No invites yet.</EmptyState>}
          {invites.length > 0 && (
            <ul className={styles.memberList}>
              {invites.map((invite) => {
                const resendStatus = resendStatusByInviteId[invite.id];
                return (
                  <li key={invite.id} className={styles.memberRow}>
                    <div className={styles.memberIdentity}>
                      <Text as="span">{invite.email}</Text>
                      <Chip tone={invite.consumed_at === null ? 'neutral' : 'ok'}>{invite.consumed_at === null ? 'Pending' : 'Joined'}</Chip>
                      <Chip tone="neutral">{invite.role}</Chip>
                      <Text as="span" tone="muted" size="sm">
                        {invite.last_sent_at ? `Email last sent ${formatRelativeTime(invite.last_sent_at, new Date())}` : 'Email not sent yet'}
                      </Text>
                      {resendStatus === 'error' && (
                        <Text as="span" tone="muted" size="sm">
                          Resend failed
                        </Text>
                      )}
                    </div>
                    <div className={styles.memberActions}>
                      {invite.consumed_at === null && (
                        <Button
                          variant="ghost"
                          aria-label={`Resend invite for ${invite.email}`}
                          disabled={resendStatus === 'sending'}
                          onClick={() => {
                            setResendStatusByInviteId((prev) => ({ ...prev, [invite.id]: 'sending' }));
                            void resendInviteRow(invite.id).then((result) => {
                              setResendStatusByInviteId((prev) => ({ ...prev, [invite.id]: result === 'sent' ? 'sent' : 'error' }));
                            });
                          }}
                        >
                          {resendStatus === 'sending' ? 'Resending…' : 'Resend'}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        aria-label={`Revoke invite for ${invite.email}`}
                        onClick={() => {
                          void revokeInviteRow(invite.id);
                        }}
                      >
                        Revoke
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {canManage && (
        <Panel>
          <EntraSignInPanel orgId={organisation.id} />
        </Panel>
      )}

      {canManage && (
        <Panel>
          <AttributeDefinitionsPanel orgId={organisation.id} userId={userId} />
        </Panel>
      )}

      {canManage && (
        <Panel>
          <Text as="h2" size="lg">
            Membership audit
          </Text>
          {memberEventsError !== null && <Text as="p">{memberEventsError}</Text>}
          {!memberEventsLoading && memberEvents.length === 0 && <EmptyState>No membership activity yet.</EmptyState>}
          {memberEvents.length > 0 && (
            <ul className={styles.memberList}>
              {memberEvents.map((event) => {
                const nameFor = (userId: UUID | null) => {
                  if (userId === null) return 'Someone';
                  const profile = memberEventProfiles.get(userId);
                  if (!profile) return 'Unknown member';
                  return profile.display_name ?? `@${profile.handle}`;
                };
                return (
                  <li key={event.id} className={styles.memberRow}>
                    <Text as="span">{memberEventSentence(event, nameFor)}</Text>
                    <Text as="span" tone="muted" size="sm">
                      {formatDate(event.created_at)}
                    </Text>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

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
