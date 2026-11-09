import { describe, expect, it } from 'vitest';
import { defaultUserPreferences, fromUserPreferencesRow, resolveStartPage, START_PAGES, toUserPreferencesRow } from './userPreferences';

describe('defaultUserPreferences', () => {
  it('gives owners/architects the architect door and everyone else the director door', () => {
    expect(defaultUserPreferences('u1', true).homeMode).toBe('architect');
    expect(defaultUserPreferences('u1', false).homeMode).toBe('director');
  });

  it('defaults theme to system and density to comfortable, per SPEC §3.2', () => {
    const prefs = defaultUserPreferences('u1', false);
    expect(prefs.theme).toBe('system');
    expect(prefs.density).toBe('comfortable');
  });

  it('defaults capabilityMapColourBy to null — no row means no saved override (Sprint U4-1 C4)', () => {
    expect(defaultUserPreferences('u1', false).capabilityMapColourBy).toBeNull();
  });
});

describe('capabilityMapColourBy wire <-> row (Sprint U4-1 C4)', () => {
  it('carries a real mode through toUserPreferencesRow/fromUserPreferencesRow unchanged', () => {
    const prefs = { ...defaultUserPreferences('u1', true), capabilityMapColourBy: 'metric:lifecycleExposure' as const };
    const row = toUserPreferencesRow(prefs);
    expect(row.capability_map_colour_by).toBe('metric:lifecycleExposure');
    expect(fromUserPreferencesRow(row).capabilityMapColourBy).toBe('metric:lifecycleExposure');
  });

  it('carries null through unchanged', () => {
    const row = toUserPreferencesRow(defaultUserPreferences('u1', true));
    expect(row.capability_map_colour_by).toBeNull();
    expect(fromUserPreferencesRow(row).capabilityMapColourBy).toBeNull();
  });
});

describe('landscape lane collapse/pin/hide wire <-> row (V2)', () => {
  it('defaults all four to null — no row means no saved override, same as capabilityMapColourBy', () => {
    const prefs = defaultUserPreferences('u1', false);
    expect(prefs.landscapeCollapsedLaneKeys).toBeNull();
    expect(prefs.landscapeExpandedLaneKeys).toBeNull();
    expect(prefs.landscapePinnedLaneKeys).toBeNull();
    expect(prefs.landscapeHiddenLaneKeys).toBeNull();
  });

  it('carries a real array through toUserPreferencesRow/fromUserPreferencesRow unchanged, for each field', () => {
    const prefs = {
      ...defaultUserPreferences('u1', true),
      landscapeCollapsedLaneKeys: ['cap-a', 'cap-b'],
      landscapeExpandedLaneKeys: ['$ot'],
      landscapePinnedLaneKeys: ['cap-c', 'cap-a'],
      landscapeHiddenLaneKeys: ['cap-d'],
    };
    const row = toUserPreferencesRow(prefs);
    expect(row.landscape_collapsed_lane_keys).toEqual(['cap-a', 'cap-b']);
    expect(row.landscape_expanded_lane_keys).toEqual(['$ot']);
    expect(row.landscape_pinned_lane_keys).toEqual(['cap-c', 'cap-a']);
    expect(row.landscape_hidden_lane_keys).toEqual(['cap-d']);
    const back = fromUserPreferencesRow(row);
    expect(back.landscapeCollapsedLaneKeys).toEqual(['cap-a', 'cap-b']);
    expect(back.landscapeExpandedLaneKeys).toEqual(['$ot']);
    expect(back.landscapePinnedLaneKeys).toEqual(['cap-c', 'cap-a']);
    expect(back.landscapeHiddenLaneKeys).toEqual(['cap-d']);
  });

  it('carries null through unchanged, for each field', () => {
    const row = toUserPreferencesRow(defaultUserPreferences('u1', true));
    expect(row.landscape_collapsed_lane_keys).toBeNull();
    expect(row.landscape_expanded_lane_keys).toBeNull();
    expect(row.landscape_pinned_lane_keys).toBeNull();
    expect(row.landscape_hidden_lane_keys).toBeNull();
    const back = fromUserPreferencesRow(row);
    expect(back.landscapeCollapsedLaneKeys).toBeNull();
    expect(back.landscapeExpandedLaneKeys).toBeNull();
    expect(back.landscapePinnedLaneKeys).toBeNull();
    expect(back.landscapeHiddenLaneKeys).toBeNull();
  });
});

describe('notification preferences wire <-> row (Sprint F7 item 3)', () => {
  it('defaults all three to true — notify is the sensible default until a user says otherwise', () => {
    const prefs = defaultUserPreferences('u1', false);
    expect(prefs.notifyOnMention).toBe(true);
    expect(prefs.notifyOnReply).toBe(true);
    expect(prefs.notifyOnReviewAssigned).toBe(true);
  });

  it('carries false through toUserPreferencesRow/fromUserPreferencesRow unchanged, for each field independently', () => {
    const prefs = { ...defaultUserPreferences('u1', true), notifyOnMention: false };
    const row = toUserPreferencesRow(prefs);
    expect(row.notify_on_mention).toBe(false);
    expect(row.notify_on_reply).toBe(true);
    expect(row.notify_on_review_assigned).toBe(true);
    const back = fromUserPreferencesRow(row);
    expect(back.notifyOnMention).toBe(false);
    expect(back.notifyOnReply).toBe(true);
    expect(back.notifyOnReviewAssigned).toBe(true);
  });

  it('notifyOnReviewAssigned (F3a follow-up) carries false through independently of the other two', () => {
    const prefs = { ...defaultUserPreferences('u1', true), notifyOnReviewAssigned: false };
    const row = toUserPreferencesRow(prefs);
    expect(row.notify_on_review_assigned).toBe(false);
    expect(row.notify_on_mention).toBe(true);
    expect(row.notify_on_reply).toBe(true);
    expect(fromUserPreferencesRow(row).notifyOnReviewAssigned).toBe(false);
  });
});

describe('inspectorCollapsed wire <-> row (V2b)', () => {
  it('defaults to false — open is the sensible starting point for everyone', () => {
    expect(defaultUserPreferences('u1', false).inspectorCollapsed).toBe(false);
  });

  it('carries true through toUserPreferencesRow/fromUserPreferencesRow unchanged', () => {
    const prefs = { ...defaultUserPreferences('u1', true), inspectorCollapsed: true };
    const row = toUserPreferencesRow(prefs);
    expect(row.inspector_collapsed).toBe(true);
    expect(fromUserPreferencesRow(row).inspectorCollapsed).toBe(true);
  });

  it('carries false through unchanged', () => {
    const row = toUserPreferencesRow(defaultUserPreferences('u1', true));
    expect(row.inspector_collapsed).toBe(false);
    expect(fromUserPreferencesRow(row).inspectorCollapsed).toBe(false);
  });
});

describe('startPage wire <-> row', () => {
  it('is null until chosen, so the role decides', () => {
    expect(defaultUserPreferences('u1', true).startPage).toBeNull();
    expect(resolveStartPage(null, true)).toBe('home');
    expect(resolveStartPage(null, false)).toBe('capability-map');
  });

  it('a saved choice wins over the role default', () => {
    expect(resolveStartPage('landscape', true)).toBe('landscape');
    expect(resolveStartPage('home', false)).toBe('home');
  });

  it('carries every start page through toUserPreferencesRow/fromUserPreferencesRow unchanged', () => {
    for (const startPage of START_PAGES) {
      const row = toUserPreferencesRow({ ...defaultUserPreferences('u1', false), startPage });
      expect(row.start_page).toBe(startPage);
      expect(fromUserPreferencesRow(row).startPage).toBe(startPage);
    }
    expect(toUserPreferencesRow(defaultUserPreferences('u1', false)).start_page).toBeNull();
  });
});
