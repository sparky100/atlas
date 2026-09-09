import { useId, useState } from 'react';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { SourceRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { lifecycleToneFor } from '../../elements/lifecycleTone';
import { Button } from '../Button/Button';
import { Chip } from '../Chip/Chip';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { FactBadge } from '../FactBadge/FactBadge';
import type { FactsRow } from '../../../contracts/rows';
import { Text } from '../Text/Text';
import styles from './ElementHeader.module.css';

export interface ElementHeaderProps {
  element: ElementsHeadRow;
  existsFact: FactsRow | undefined;
  existsSource: SourceRow | undefined;
  /**
   * `Edit` (§4.2), shown only when the caller has already established its
   * gate: `canEditBranch(role, editingBranch)` (src/ui/orgs/roleGates.ts) —
   * owner/architect at `main`, or owner/architect/contributor on a `draft`
   * change branch (Sprint C1 step 9 wired the branch half of this in;
   * step 4 had already generalised the editing hooks themselves to take
   * any branch, but no page actually picked one other than main until
   * now). A tag is never editable either way. `Propose a change…` (the
   * contributor path at `main`/a tag, opening a branch picker inline) still
   * isn't built — a real, named gap, not this component's to fill: a
   * contributor there gets no `Edit` affordance at all rather than an
   * inert one (CLAUDE.md rule 7). Omitted entirely otherwise, not shown
   * disabled, for the same reason.
   */
  onEdit?: (() => void) | undefined;
}

/**
 * The identity header (§4.2). `Propose a change…` (the contributor path at
 * `main`/a tag, opening a branch picker inline) still isn't built — a real,
 * named gap (see `onEdit`'s own comment) — so `Edit` only ever appears for
 * the role/ref combinations `canEditBranch` actually allows: owner/architect
 * at `main` (ADR-015), or owner/architect/contributor on a draft change
 * branch (Sprint C1).
 *
 * Sprint U4-1 D1: the raw element id is no longer shown directly in the
 * meta row — it's an internal identifier a reader almost never needs at a
 * glance, and showing it unconditionally crowded the one badge that
 * actually matters here (below). It's still one click away, behind this
 * header's own overflow menu ("⋯"), not removed outright. Aliases moved
 * out of this component entirely, into the element page's own Attributes
 * section (`ElementPage.tsx`'s `AttributesTable`/`AttributesEditor`,
 * `src/ui/elements/aliasLabels.ts`'s `aliasAsFact`) — they're identifying
 * facts about the element, the same shape as any other attribute, not
 * header chrome. What's left here is exactly "one provenance badge for
 * the element's existence fact" (`existsFact`), the sprint item's own
 * wording — nothing else competes with it for attention.
 */
export function ElementHeader({ element, existsFact, existsSource, onEdit }: ElementHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuId = useId();
  const attrs = attributesRecord(element.attributes);
  const lifecycleStatus = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  const isExternal = attrs.isExternal === true;
  const externalOrganisation = typeof attrs.externalOrganisation === 'string' ? attrs.externalOrganisation : null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(element.element_id);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // not worth surfacing as an error for a copy-to-clipboard nicety.
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <ElementTypeGlyph type={element.element_type} external={isExternal} />
        <Text as="h1" size="2xl">
          {element.name}
        </Text>
        {lifecycleStatus !== null && lifecycleTone !== undefined && <Chip tone={lifecycleTone}>{lifecycleStatus}</Chip>}
        {isExternal && <Chip tone="neutral">{externalOrganisation ? `external (${externalOrganisation})` : 'external'}</Chip>}
      </div>
      <div className={styles.metaRow}>
        {existsFact && <FactBadge fact={existsFact} source={existsSource} />}
        {onEdit && (
          <Button variant="ghost" onClick={onEdit}>
            ✎ Edit
          </Button>
        )}
        <div className={styles.menuWrapper}>
          <button type="button" className={styles.menuToggle} aria-expanded={menuOpen} aria-controls={menuId} aria-label="Element actions" onClick={() => { setMenuOpen((o) => !o); }}>
            <span aria-hidden="true">⋯</span>
          </button>
          <div id={menuId} className={[styles.menu, menuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
            <button type="button" className={styles.menuItem} onClick={() => void copyId()}>
              <Text as="span">{copied ? 'Copied' : 'Copy element ID'}</Text>
              <Text mono size="sm" tone="muted" as="span">
                {element.element_id.slice(0, 8)}…
              </Text>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
