import { describe, expect, it } from 'vitest';
import { forcedOwnsAttributes, forcedOwnsRole, isSlotApplicable } from './slotApplicability';

describe('isSlotApplicable (C22)', () => {
  it('hides the inbound enables slot on a top-level value stream', () => {
    expect(isSlotApplicable('enables', 'inbound', 'value_stream', null)).toBe(false);
  });
  it('keeps the inbound enables slot on a stage', () => {
    expect(isSlotApplicable('enables', 'inbound', 'value_stream', 'stream-id')).toBe(true);
  });
  it('leaves every other slot alone', () => {
    expect(isSlotApplicable('enables', 'outbound', 'capability', null)).toBe(true);
    expect(isSlotApplicable('supports', 'inbound', 'capability', null)).toBe(true);
    expect(isSlotApplicable('owns', 'inbound', 'system', null)).toBe(true);
  });
});

describe('forcedOwnsRole (C20)', () => {
  it('forces service for an external actor owning something', () => {
    expect(forcedOwnsRole('owns', 'outbound', true)).toBe('service');
    expect(forcedOwnsAttributes('owns', 'outbound', true)).toEqual({ role: 'service' });
  });
  it('does not force a role for an internal actor, the owned side, or other types', () => {
    expect(forcedOwnsRole('owns', 'outbound', false)).toBeUndefined();
    expect(forcedOwnsRole('owns', 'inbound', true)).toBeUndefined();
    expect(forcedOwnsRole('uses', 'outbound', true)).toBeUndefined();
    expect(forcedOwnsAttributes('uses', 'outbound', true)).toBeUndefined();
  });
});
