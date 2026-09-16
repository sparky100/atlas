import { describe, expect, it } from 'vitest';
import type { MemberEventRow } from '../../db/types';
import { memberEventSentence } from './memberEventFormat';

const ALICE = 'alice-id';
const BOB = 'bob-id';

const NAMES: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob' };
const nameFor = (userId: string | null) => (userId !== null ? (NAMES[userId] ?? 'Unknown member') : 'Someone');

function baseEvent(overrides: Partial<MemberEventRow>): MemberEventRow {
  return {
    id: 'event-1',
    org_id: 'org-1',
    event_type: 'joined',
    target_user_id: null,
    target_email: null,
    actor_id: null,
    role: null,
    previous_role: null,
    created_at: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('memberEventSentence', () => {
  it('invited', () => {
    const event = baseEvent({ event_type: 'invited', actor_id: ALICE, target_email: 'new@example.test', role: 'contributor' });
    expect(memberEventSentence(event, nameFor)).toBe('Alice invited new@example.test as contributor.');
  });

  it('invite_revoked', () => {
    const event = baseEvent({ event_type: 'invite_revoked', actor_id: ALICE, target_email: 'new@example.test' });
    expect(memberEventSentence(event, nameFor)).toBe('Alice revoked the invite for new@example.test.');
  });

  it('joined, invited by someone else', () => {
    const event = baseEvent({ event_type: 'joined', actor_id: ALICE, target_user_id: BOB, role: 'viewer' });
    expect(memberEventSentence(event, nameFor)).toBe('Bob joined as viewer, invited by Alice.');
  });

  it('joined, self-inviting (organisation creation) omits the redundant "invited by"', () => {
    const event = baseEvent({ event_type: 'joined', actor_id: ALICE, target_user_id: ALICE, role: 'owner' });
    expect(memberEventSentence(event, nameFor)).toBe('Alice joined as owner.');
  });

  it('joined with no actor at all', () => {
    const event = baseEvent({ event_type: 'joined', actor_id: null, target_user_id: BOB, role: 'viewer' });
    expect(memberEventSentence(event, nameFor)).toBe('Bob joined as viewer.');
  });

  it('role_changed', () => {
    const event = baseEvent({ event_type: 'role_changed', actor_id: ALICE, target_user_id: BOB, previous_role: 'contributor', role: 'architect' });
    expect(memberEventSentence(event, nameFor)).toBe("Alice changed Bob's role from contributor to architect.");
  });

  it('removed', () => {
    const event = baseEvent({ event_type: 'removed', actor_id: ALICE, target_user_id: BOB });
    expect(memberEventSentence(event, nameFor)).toBe('Alice removed Bob.');
  });

  it('left', () => {
    const event = baseEvent({ event_type: 'left', actor_id: BOB, target_user_id: BOB });
    expect(memberEventSentence(event, nameFor)).toBe('Bob left.');
  });
});
