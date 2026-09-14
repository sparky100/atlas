/**
 * RT-9 (SPEC-data-model.md §10.1), round-trip half: arbitrary
 * `UserPreferences` → row → `UserPreferences` is deep-equal. The other half
 * (a user reads only their own row) is an RLS property, exercised against a
 * real Postgres in src/db/repository.integration.test.ts, not here.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_MAP_COLOUR_BY_MODES,
  DENSITY_PREFERENCES,
  fromUserPreferencesRow,
  HOME_MODES,
  LANDSCAPE_COLOUR_BY_MODES,
  THEME_PREFERENCES,
  toUserPreferencesRow,
  type UserPreferences,
} from './userPreferences';

const userPreferencesArb: fc.Arbitrary<UserPreferences> = fc.record({
  userId: fc.uuid(),
  homeMode: fc.constantFrom(...HOME_MODES),
  density: fc.constantFrom(...DENSITY_PREFERENCES),
  theme: fc.constantFrom(...THEME_PREFERENCES),
  // Sprint U4-1 C4: nullable, unlike its three siblings above — `null`
  // ("no saved override") is as much a real value here as any mode name.
  capabilityMapColourBy: fc.option(fc.constantFrom(...CAPABILITY_MAP_COLOUR_BY_MODES), { nil: null }),
  // Prompt 7k item 1: same nullable shape, a sibling column not a shared one.
  landscapeColourBy: fc.option(fc.constantFrom(...LANDSCAPE_COLOUR_BY_MODES), { nil: null }),
  // V2: arbitrary strings are fine here — round-trip only needs identity
  // preservation, not semantic lane-key validity (a real lane key is
  // whatever `layout.ts`'s own lane keys happen to be, which this test
  // doesn't need to know about).
  landscapeCollapsedLaneKeys: fc.option(fc.array(fc.string()), { nil: null }),
  landscapeExpandedLaneKeys: fc.option(fc.array(fc.string()), { nil: null }),
  landscapePinnedLaneKeys: fc.option(fc.array(fc.string()), { nil: null }),
  // Sprint F7 item 3: always a real boolean, never nullable (unlike the
  // colour-by/lane-key fields above) — no context-dependent default to
  // compute.
  notifyOnMention: fc.boolean(),
  notifyOnReply: fc.boolean(),
  updatedAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
});

describe('UserPreferences round-trip (RT-9)', () => {
  it('toUserPreferencesRow then fromUserPreferencesRow is the identity, for any UserPreferences', () => {
    fc.assert(
      fc.property(userPreferencesArb, (prefs) => {
        expect(fromUserPreferencesRow(toUserPreferencesRow(prefs))).toEqual(prefs);
      }),
    );
  });
});
