import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BlueprintFrame } from '../BlueprintFrame/BlueprintFrame';
import { Chip, type ChipTone } from '../Chip/Chip';
import { Text } from '../Text/Text';
import styles from './CapabilityTile.module.css';

export interface CapabilityTileProps {
  href: string;
  name: string;
  tone: ChipTone | undefined;
  toneLabel: string | undefined;
  /** `'card'` (default) — the capability map's L2 cards. `'compact'` — the smaller inline pill L3 uses, revealed only when its parent card expands. */
  size?: 'card' | 'compact';
  /**
   * Secondary controls, and any further nested content (a zoom link,
   * reorder buttons, an expand toggle, a list of child tiles) — rendered
   * as ordinary DOM content *after* the tile's own primary link, not
   * inside it. See this component's own module comment for why: the
   * primary link is a "stretched link" (a full-tile `::after` overlay),
   * specifically so real interactive descendants passed here stay
   * independently clickable rather than nesting inside an `<a>` — which
   * HTML disallows for another link, and which browsers and screen
   * readers handle unreliably even for a `<button>`.
   */
  children?: ReactNode;
}

/**
 * Sprint U4-1 C3's shared tile: "blueprint-framed tile component from the
 * design handoff [...]; plain-text name; whole tile is the click target;
 * no underlined links; colour-by tone fills the tile with an accessible
 * label." Reuses the existing design-handoff frame (`BlueprintFrame.tsx`,
 * Handoff 7d) rather than inventing a second framing treatment, and the
 * same tinted-background formula `Chip.module.css` already uses for tone
 * (`color-mix(in srgb, var(--status-X) 16%, transparent)` — "readable in
 * both themes, never the same as a diff marker") so the tile's own fill
 * and its Chip read as one consistent tone, not two.
 *
 * "Whole tile is the click target" without breaking `children`'s own
 * interactive content: `.primaryLink` (module CSS) is a "stretched
 * link" — its `::after` is absolutely positioned to cover the whole
 * frame, rather than the link literally wrapping the tile's content. A
 * `.secondary` wrapper around `children` is explicitly `position:
 * relative` so it paints (and hit-tests) above that overlay regardless of
 * DOM order — CSS's own painting order puts positioned elements above
 * plain in-flow content, not the reverse, so without this any button or
 * link passed as `children` would be visually present but unclickable,
 * covered by the overlay. This is the standard accessible "clickable
 * card" pattern (colloquially "stretched link"): one real link for
 * keyboard/screen-reader navigation, real secondary controls that stay
 * real controls, no `<a>`-inside-`<a>` or `<button>`-inside-`<a>`
 * nesting either would require.
 *
 * Never colour-only (§6.3/§8.4/§8.7): `toneLabel` — the same word a Chip
 * elsewhere in this product would carry for the same tone — always sits
 * next to the fill, not instead of it.
 *
 * Used by `CapabilityMapView.tsx`'s L2 cards (`size: 'card'`) and L3
 * tiles (`size: 'compact'`) — not L1: an L1 column holds several
 * independently-clickable L2 cards, not one clickable unit, so "whole
 * tile is the click target" doesn't apply to it the same way, and L1
 * doesn't participate in colour-by today either.
 */
export function CapabilityTile({ href, name, tone, toneLabel, size = 'card', children }: CapabilityTileProps) {
  const hasChip = tone !== undefined && toneLabel !== undefined;
  return (
    <BlueprintFrame interactive>
      <div className={size === 'compact' ? styles.tileCompact : styles.tile} data-tone={tone ?? 'none'}>
        <Link to={href} className={styles.primaryLink}>
          <Text as="span" size={size === 'compact' ? 'sm' : 'md'} className={styles.name}>
            {name}
          </Text>
        </Link>
        {/*
         * Sprint U4-2b item 3: "every tile reserves the chip row so tiles
         * in a column are equal height" — a tile whose colour-by mode has
         * nothing to say about it (`tone`/`toneLabel` both undefined)
         * used to skip the chip row entirely, so it sat shorter than its
         * siblings that did have one. Always rendering the Chip and
         * hiding it with `visibility: hidden` (not `display: none`, which
         * would collapse the row back to nothing) keeps every tile's own
         * chip-row height identical regardless of whether this one has
         * something to show — a plain, non-`aria-hidden` invisible
         * element is already unreachable to assistive tech via
         * `visibility: hidden` on its own, so no extra `aria-hidden` is
         * needed for the placeholder case.
         */}
        <span className={hasChip ? undefined : styles.chipPlaceholder}>
          <Chip tone={tone ?? 'neutral'}>{toneLabel ?? ' '}</Chip>
        </span>
        {children !== undefined && <span className={styles.secondary}>{children}</span>}
      </div>
    </BlueprintFrame>
  );
}
