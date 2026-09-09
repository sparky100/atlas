import { useEffect, useState } from 'react';

/**
 * Sprint U4-1 E1: whether the viewport is at or below `breakpointPx`, kept
 * live via `matchMedia`'s own `change` event (`ThemeProvider.tsx`'s
 * `prefers-color-scheme` listener is the existing precedent for this
 * shape in this codebase).
 *
 * `LandscapePage.tsx`'s actions row needs this in JS, not just a CSS
 * breakpoint, because its two arrangements (a flat row of two
 * `ElementSearchAdd` controls vs. those same two controls nested inside a
 * disclosure menu) mount genuinely different markup rather than the same
 * markup restyled — and `ElementSearchAdd`'s own search pool fetch
 * (`useElementSearchAdd.ts`) starts as soon as it mounts. Rendering both
 * arrangements at once and hiding one with CSS — the way
 * `ElementHeader.tsx`'s always-collapsed overflow menu or `UserMenu.tsx`'s
 * bar/menu swap both do, harmlessly, for inert markup — would double that
 * fetch for no reason here. `typeof window !== 'undefined'` guards the
 * initial read the same defensive way `ThemeProvider.tsx`'s own
 * `systemPrefersDark` does, even though this app doesn't currently
 * render server-side.
 */
export function useIsNarrowViewport(breakpointPx: number): boolean {
  const query = `(max-width: ${breakpointPx.toString()}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(query);
    const onChange = () => {
      setNarrow(media.matches);
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [query]);

  return narrow;
}
