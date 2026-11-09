import { describe, expect, it } from 'vitest';
import { buildShareUrl, isOnChange } from './shareLink';

const O = 'https://atlas.simmodlr.app';
const P = '/o/acme/m/main/context/e1';

describe('buildShareUrl', () => {
  it('leaves a plain link unchanged', () => {
    expect(buildShareUrl(O, P, '', 'main')).toBe(`${O}${P}`);
  });
  it('keeps view state such as filters and capability focus', () => {
    expect(buildShareUrl(O, P, '?capability=c1&filter=eol', 'main')).toBe(`${O}${P}?capability=c1&filter=eol`);
  });
  it('drops the sender’s selected change by default', () => {
    expect(buildShareUrl(O, P, '?ref=branch:b1&viewing=1&mode=diff&capability=c1', 'main')).toBe(`${O}${P}?capability=c1`);
  });
  it('keeps the change, read-only, when asked', () => {
    expect(buildShareUrl(O, P, '?ref=branch:b1', 'change')).toBe(`${O}${P}?ref=branch%3Ab1&viewing=1`);
  });
  it('keeps tag and commit refs', () => {
    expect(buildShareUrl(O, P, '?ref=tag:v1', 'main')).toBe(`${O}${P}?ref=tag%3Av1`);
    expect(buildShareUrl(O, P, '?ref=commit:c9', 'main')).toBe(`${O}${P}?ref=commit%3Ac9`);
  });
});

describe('isOnChange', () => {
  it('is true only for a branch ref', () => {
    expect(isOnChange('?ref=branch:b1')).toBe(true);
    expect(isOnChange('?ref=tag:v1')).toBe(false);
    expect(isOnChange('')).toBe(false);
  });
});
