import { Fragment, useMemo, useState } from 'react';
import { isInactive, latestUse, PLATFORM_ADMIN_INACTIVE_DAYS, type PlatformAdminPerson } from '../../contracts/platformAdmin';
import { Chip } from '../components/Chip/Chip';
import { Loading } from '../components/Loading/Loading';
import { SettingsSection } from '../components/SettingsSection/SettingsSection';
import { Text } from '../components/Text/Text';
import { usePlatformAdminOverview } from './usePlatformAdminOverview';
import styles from './PlatformAdminOverview.module.css';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatDate(value: string | null): string {
  return value === null ? 'Never' : dateFormat.format(new Date(value));
}

function Inactive({ lastUse, now }: { lastUse: string | null; now: Date }) {
  if (!isInactive(lastUse, now)) return null;
  return <Chip tone="warn">Not used in {PLATFORM_ADMIN_INACTIVE_DAYS}+ days</Chip>;
}

/**
 * Platform admin: every organisation and every person, with how much each
 * is used, when they joined and when they last used Atlas. Read-only, counts
 * and dates only. "Last sign-in" and "last change" are shown separately
 * because someone who only reads never makes a change.
 */
export function PlatformAdminOverview() {
  const state = usePlatformAdminOverview();
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const now = useMemo(() => new Date(), []);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <Text as="p" tone="default">
        Couldn&apos;t load organisations and people: {state.message}
      </Text>
    );
  }

  const term = search.trim().toLowerCase();
  const people = term === '' ? state.people : state.people.filter((p) => (p.email ?? '').toLowerCase().includes(term));
  const membersOf = (orgId: string): { person: PlatformAdminPerson; role: string; joinedAt: string }[] =>
    state.people.flatMap((person) => {
      const m = person.memberships.find((x) => x.orgId === orgId);
      return m ? [{ person, role: m.role, joinedAt: m.joinedAt }] : [];
    });

  return (
    <>
      <SettingsSection id="organisations" title="Organisations" summary={String(state.organisations.length)}>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Created</th>
                <th>People</th>
                <th>Elements</th>
                <th>Changes, last 30 days</th>
                <th>Active people, last 30 days</th>
                <th>Last signed in</th>
                <th>Last change</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.organisations.map((org) => {
                const open = openOrg === org.orgId;
                return (
                  <Fragment key={org.orgId}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className={styles.link}
                          aria-expanded={open}
                          onClick={() => {
                            setOpenOrg(open ? null : org.orgId);
                          }}
                        >
                          {org.name}
                        </button>
                      </td>
                      <td>{formatDate(org.createdAt)}</td>
                      <td>{org.memberCount}</td>
                      <td>{org.elementCount}</td>
                      <td>{org.changes30d}</td>
                      <td>{org.activePeople30d}</td>
                      <td>{formatDate(org.lastSignInAt)}</td>
                      <td>{formatDate(org.lastChangeAt)}</td>
                      <td>
                        <Inactive lastUse={latestUse(org.lastSignInAt, org.lastChangeAt)} now={now} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={9} className={styles.detail}>
                          {membersOf(org.orgId).map(({ person, role, joinedAt }) => (
                            <div key={person.userId} className={styles.memberRow}>
                              <span>{person.email ?? 'No email'}</span>
                              <span>{role}</span>
                              <span>Joined {formatDate(joinedAt)}</span>
                              <span>Last signed in {formatDate(person.lastSignInAt)}</span>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      <SettingsSection id="people" title="People" summary={String(state.people.length)}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search by email"
          aria-label="Search people by email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Organisations</th>
                <th>Signed up</th>
                <th>Last signed in</th>
                <th>Last change</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId}>
                  <td>{p.email ?? 'No email'}</td>
                  <td>
                    {p.memberships.length === 0
                      ? 'None'
                      : p.memberships.map((m) => `${m.orgName} (${m.role}, joined ${formatDate(m.joinedAt)})`).join('; ')}
                  </td>
                  <td>{formatDate(p.signedUpAt)}</td>
                  <td>{formatDate(p.lastSignInAt)}</td>
                  <td>{formatDate(p.lastChangeAt)}</td>
                  <td>
                    <Inactive lastUse={latestUse(p.lastSignInAt, p.lastChangeAt)} now={now} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people.length === 0 && (
          <Text as="p" tone="muted" size="sm">
            No one matches that email.
          </Text>
        )}
      </SettingsSection>
    </>
  );
}
