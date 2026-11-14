/**
 * Wire contract for the platform admin overview
 * (`supabase/migrations/20261114080000_platform_admin_overview.sql`):
 * read-only lists of every organisation and person, with usage and last use.
 * Types and one pure helper: no I/O. Counts and dates only, never model content.
 */
import type { UUID } from './delta';

export const PLATFORM_ADMIN_INACTIVE_DAYS = 30;

export interface PlatformAdminOrganisation {
  orgId: UUID;
  name: string;
  createdAt: string;
  memberCount: number;
  elementCount: number;
  /** Changes made in the last 30 days. */
  changes30d: number;
  /** Members who signed in during the last 30 days. */
  activePeople30d: number;
  /** Newest change made in the organisation; null if nothing was ever changed. */
  lastChangeAt: string | null;
  /** Latest sign-in by any member; null if none has signed in. */
  lastSignInAt: string | null;
}

export interface PlatformAdminMembership {
  orgId: UUID;
  orgName: string;
  role: string;
  joinedAt: string;
}

export interface PlatformAdminPerson {
  userId: UUID;
  email: string | null;
  signedUpAt: string;
  lastSignInAt: string | null;
  /** Newest change this person made; null if they have never made one. */
  lastChangeAt: string | null;
  memberships: PlatformAdminMembership[];
}

/** True when the date is missing or older than the inactive window: the one thing the overview marks. */
export function isInactive(lastUse: string | null, now: Date): boolean {
  if (lastUse === null) return true;
  const ms = now.getTime() - new Date(lastUse).getTime();
  return ms > PLATFORM_ADMIN_INACTIVE_DAYS * 24 * 60 * 60 * 1000;
}

/** The most recent of the two last-use dates, or null when both are missing. */
export function latestUse(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
