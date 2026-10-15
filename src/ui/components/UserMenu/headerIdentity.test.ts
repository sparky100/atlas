import { describe, expect, it } from 'vitest';
import { headerDisplayName, headerInitials } from './headerIdentity';

describe('headerDisplayName', () => {
  it('prefers the display name, trimmed', () => {
    expect(headerDisplayName({ display_name: '  Ada Lovelace ', handle: 'ada' }, 'ada@example.com')).toBe('Ada Lovelace');
  });
  it('falls back to the handle, then the email local part, then "Account"', () => {
    expect(headerDisplayName({ display_name: null, handle: 'ada' }, 'ada@example.com')).toBe('ada');
    expect(headerDisplayName(null, 'ada.l@example.com')).toBe('ada.l');
    expect(headerDisplayName(null, null)).toBe('Account');
  });
});

describe('headerInitials', () => {
  it('takes up to two initials from the display name', () => {
    expect(headerInitials({ display_name: 'ada byron lovelace', handle: 'ada' }, null)).toBe('AB');
    expect(headerInitials({ display_name: 'Ada', handle: 'ada' }, null)).toBe('A');
  });
  it('falls back to the handle, then the email, then "?"', () => {
    expect(headerInitials({ display_name: null, handle: 'zed' }, 'ada@example.com')).toBe('Z');
    expect(headerInitials(null, 'ada@example.com')).toBe('A');
    expect(headerInitials(null, null)).toBe('?');
  });
});
