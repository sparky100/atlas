import { describe, expect, it } from 'vitest';
import { validateElementLink } from './elementLink';

describe('validateElementLink', () => {
  it('trims and classifies an https link', () => {
    expect(validateElementLink({ label: ' Design ', pointer: ' https://x.atlassian.net/wiki/a ' })).toEqual({ ok: true, value: { label: 'Design', pointer: 'https://x.atlassian.net/wiki/a', kind: 'link' } });
  });
  it('accepts a plain reference', () => {
    expect(validateElementLink({ label: 'Cases', pointer: 'SharePoint > Business cases' })).toEqual({ ok: true, value: { label: 'Cases', pointer: 'SharePoint > Business cases', kind: 'reference' } });
  });
  it.each(['javascript:alert(1)', 'ftp://host/a', 'file:///etc/passwd', 'data:text/html,x'])('refuses %s', (p) => {
    expect(validateElementLink({ label: 'a', pointer: p }).ok).toBe(false);
  });
  it('refuses blanks and spaced links', () => {
    expect(validateElementLink({ label: ' ', pointer: 'x' }).ok).toBe(false);
    expect(validateElementLink({ label: 'a', pointer: '' }).ok).toBe(false);
    expect(validateElementLink({ label: 'a', pointer: 'https://a b' }).ok).toBe(false);
  });
});
