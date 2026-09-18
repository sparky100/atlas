import { useId, useState } from 'react';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { SourceRow } from '../../../db/types';
import { attributesRecord } from '../../elements/attributesRecord';
import { lifecycleToneFor } from '../../elements/lifecycleTone';
import type { UseElementRenameResult } from '../../elements/useElementRename';
import { Button } from '../Button/Button';
import { LinkButton } from '../Button/LinkButton';
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
   * now). A tag is never editable either way. Omitted entirely otherwise,
   * not shown disabled, for the same reason `onProposeChange` below is.
   */
  onEdit?: (() => void) | undefined;
  /**
   * Sprint 7i item 4: "'Propose a change' on every element page" — the gap
   * `onEdit`'s own comment used to name (a contributor at `main` got no
   * affordance here at all). Mutually exclusive with `onEdit` in practice
   * (a caller passes whichever this ref/role combination actually allows),
   * but this component doesn't enforce that itself — same
   * omitted-not-disabled convention as every other optional action here.
   */
  onProposeChange?: (() => void) | undefined;
  /**
   * Sprint U4-1 D3's "Rename" — omitted entirely, same convention as
   * `onEdit`, when the caller hasn't established edit rights (in
   * practice always together with `onEdit`, kept as its own prop since
   * `useElementRename` is a real hook — Rules of Hooks means a caller
   * can't call it conditionally, only pass its result conditionally).
   * Prompt 7h bug fix: available for every element type now, not just
   * capability — `useElementRename.ts` was already fully generic
   * (`element.element_type` in its own delta); `ElementPage.tsx`'s own
   * gate was the only thing narrowing it. "Move into Edit mode or the
   * header menu, and tapping the title": three equivalent triggers for
   * the same inline rename — a "Rename" item in this header's own
   * overflow menu, or the title itself (Prompt 7h) — replacing the
   * static name with an inline input right here, rather than a
   * standalone control sitting between Edit and Attributes.
   */
  rename?: UseElementRenameResult | undefined;
  /**
   * Prompt 7k item 5's "Retire…" (system only — `useElementRetire.ts` sets
   * `lifecycleStatus`, a field only `SystemAttributes` has). Same
   * omitted-not-disabled convention, gated on the same `canEditBranch`
   * check as `onEdit`/`rename` — "both respect the selected ref" is the
   * prompt's own wording for this and `onRemoveFromModel` below, not a
   * parallel permission check of their own.
   */
  onRetire?: (() => void) | undefined;
  /**
   * Prompt 7k item 5's "Remove from model…" — every element type, not
   * system-only. Omitted entirely (not shown disabled) whenever the
   * caller's own gate disallows it, same convention as every prop above;
   * also omitted when the element has any live children, since this
   * action's own hook (`useElementRemoveFromModel.ts`) does not attempt
   * C8's re-parenting half — see that hook's doc comment.
   */
  onRemoveFromModel?: (() => void) | undefined;
  /**
   * E7's own "Merge into…" (docs/prompts/atlas-prompt-pack.md, ADR-019) —
   * every element type. Same omitted-not-disabled convention, gated on the
   * same `canEditBranch` check as `onEdit`/`onRetire`/`onRemoveFromModel` —
   * a merge is, mechanically, exactly the edit a person would make by hand
   * (`src/db/elementMerges.ts`'s own module comment), so it needs no
   * separate role gate of its own.
   */
  onMerge?: (() => void) | undefined;
  /**
   * "Convert to a module of…" (`src/engine/convertSystemToModule.ts`'s own
   * module comment) — system only, same `canEditBranch` gate as
   * `onRetire`/`onMerge`. Omitted (not shown disabled) whenever the caller's
   * gate disallows it, or when the system already has live children of its
   * own (the engine refuses that case outright — converting a platform that
   * already has modules is out of scope), same convention `onRemoveFromModel`
   * already uses for its own children check.
   */
  onConvertToModule?: (() => void) | undefined;
  /**
   * Sticky ref close-out: "Contributors see 'read-only: under review' on
   * elements of a Proposed change." — the explanation `onEdit`'s own
   * omitted-not-disabled convention never gave: neither `onEdit` nor
   * `onProposeChange` is missing here because the viewer lacks a role
   * (that case already reads as no affordance at all, same as a viewer),
   * but because the *branch itself* stopped taking commits the moment it
   * left `draft` (`canEditBranch`'s own `status === 'draft'` gate,
   * roleGates.ts) — a state worth naming, not silently indistinguishable
   * from "you can't edit this." Rendered only when the caller passes it
   * (`ElementPage.tsx`'s own `underReview`); omitted otherwise, same
   * convention as every prop above.
   */
  readOnlyReason?: string | undefined;
  /**
   * "Context →" — a system or container's own context diagram
   * (`/context/:elementId`, `ContextPage.tsx`). Omitted entirely (not
   * shown disabled) for a capability or actor, same convention as every
   * prop above — neither has a context diagram of its own to link to (V3
   * extended this from systems-only to containers too, once "component"'s
   * removal, S1 item 18, left a container structurally terminal). A real
   * link, not implied by the breadcrumb: the breadcrumb shows *where this
   * page is*, never *what else you could navigate to* — the same
   * distinction `ContextView.tsx`'s own "Containers →" link already draws
   * for its one level down (found in a walkthrough: nothing on this page
   * linked to Context at all, the breadcrumb was the only, and wrong,
   * place a reader might have looked for it).
   */
  contextHref?: string | undefined;
}

/**
 * The identity header (§4.2). `Edit` appears only for the role/ref
 * combinations `canEditBranch` actually allows: owner/architect at `main`
 * (ADR-015), or owner/architect/contributor on a draft change branch
 * (Sprint C1). `onProposeChange` (Sprint 7i item 4) is the contributor's
 * own path at `main` — `ElementPage.tsx` passes exactly one of the two.
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
 *
 * Sprint U4-1 D3: "Rename. Move into Edit mode or the header menu; no
 * stray control between Edit and Attributes." — `rename` (when given)
 * puts a "Rename" item in the overflow menu; picking it swaps the
 * static `h1` for an inline input right here, with its own Save/Cancel,
 * independent of the Attributes section's own edit form. The old
 * standalone rename row that used to sit between this header and
 * Attributes (`CapabilityTailoringActions.tsx`, then narrowed to
 * `CapabilityRetractAction.tsx` — retract only) is gone entirely now:
 * Prompt 7k item 5 generalises retract into "Remove from model…"
 * (`onRemoveFromModel`, every element type, cascading its relationships)
 * and adds "Retire…" (`onRetire`, system only) — both live in this same
 * overflow menu, not a standalone row.
 */
export function ElementHeader({ element, existsFact, existsSource, onEdit, onProposeChange, rename, onRetire, onRemoveFromModel, onMerge, onConvertToModule, readOnlyReason, contextHref }: ElementHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuId = useId();
  const attrs = attributesRecord(element.attributes);
  const lifecycleStatus = typeof attrs.lifecycleStatus === 'string' ? attrs.lifecycleStatus : null;
  const lifecycleTone = lifecycleStatus !== null ? lifecycleToneFor(lifecycleStatus) : undefined;
  // S1 item 11: "shown by lifecycle in the header" — system and container
  // are the only two element types `version` exists on (attributeSchema.ts),
  // so this is simply absent from `attrs` for every other type, the same
  // way `lifecycleStatus` above only ever renders for the types that carry
  // it despite no explicit `element_type` check here either.
  const version = typeof attrs.version === 'string' ? attrs.version : null;
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

  const renaming = rename !== undefined && rename.status !== 'idle';

  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <ElementTypeGlyph type={element.element_type} external={isExternal} />
        {renaming ? (
          <form
            className={styles.renameForm}
            onSubmit={(e) => {
              e.preventDefault();
              void rename.save();
            }}
          >
            <input
              className={styles.renameInput}
              type="text"
              value={rename.value}
              onChange={(e) => {
                rename.setValue(e.target.value);
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- choosing "Rename" is itself the request to type a new name; same convention as RelationshipAdd.tsx/ElementSearchAdd.tsx's own inputs.
              autoFocus
            />
            <Button variant="primary" type="submit" disabled={rename.status === 'submitting'}>
              {rename.status === 'submitting' ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" type="button" onClick={rename.cancelRenaming} disabled={rename.status === 'submitting'}>
              Cancel
            </Button>
            {rename.submitError !== null && (
              <Text as="p" tone="default">
                {rename.submitError}
              </Text>
            )}
          </form>
        ) : (
          <Text as="h1" size="2xl">
            {rename ? (
              // Prompt 7h bug fix: tapping the title opens the same inline
              // rename the "⋯" menu's own "Rename" item does — a plain
              // `<button>` inside the still-real `<h1>` (not the h1 itself
              // made clickable), so the page's heading semantics/outline
              // are unchanged whether or not the viewer can rename.
              <button type="button" className={styles.titleButton} onClick={rename.startRenaming}>
                {element.name}
              </button>
            ) : (
              element.name
            )}
          </Text>
        )}
        {lifecycleStatus !== null && lifecycleTone !== undefined && <Chip tone={lifecycleTone}>{lifecycleStatus}</Chip>}
        {/* Plain text, not a Chip: version is free text in whatever scheme
            the estate actually uses ("3.4.1", "2026-Q1") — a Chip implies
            a fixed vocabulary the way lifecycle/external status actually
            are, which this isn't. No "v" prefix either, for the same
            reason: it would misrepresent a value that isn't a bare
            semver number to begin with. */}
        {version !== null && (
          <Text as="span" tone="muted" size="sm">
            {version}
          </Text>
        )}
        {isExternal && <Chip tone="neutral">{externalOrganisation ? `external (${externalOrganisation})` : 'external'}</Chip>}
      </div>
      <div className={styles.metaRow}>
        {existsFact && <FactBadge fact={existsFact} source={existsSource} />}
        {onEdit && (
          <Button variant="ghost" onClick={onEdit}>
            ✎ Edit
          </Button>
        )}
        {onProposeChange && (
          <Button variant="ghost" onClick={onProposeChange}>
            Propose a change
          </Button>
        )}
        {readOnlyReason && <Chip tone="neutral">{readOnlyReason}</Chip>}
        {contextHref && (
          <LinkButton to={contextHref} variant="secondary">
            Context →
          </LinkButton>
        )}
        <div className={styles.menuWrapper}>
          <button type="button" className={styles.menuToggle} aria-expanded={menuOpen} aria-controls={menuId} aria-label="Element actions" onClick={() => { setMenuOpen((o) => !o); }}>
            <span aria-hidden="true">⋯</span>
          </button>
          <div id={menuId} className={[styles.menu, menuOpen ? styles.open : ''].filter(Boolean).join(' ')}>
            {rename && !renaming && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  rename.startRenaming();
                }}
              >
                <Text as="span">Rename</Text>
              </button>
            )}
            <button type="button" className={styles.menuItem} onClick={() => void copyId()}>
              <Text as="span">{copied ? 'Copied' : 'Copy element ID'}</Text>
              <Text mono size="sm" tone="muted" as="span">
                {element.element_id.slice(0, 8)}…
              </Text>
            </button>
            {onRetire && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onRetire();
                }}
              >
                <Text as="span">Retire…</Text>
              </button>
            )}
            {onMerge && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onMerge();
                }}
              >
                <Text as="span">Merge into…</Text>
              </button>
            )}
            {onConvertToModule && (
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenuOpen(false);
                  onConvertToModule();
                }}
              >
                <Text as="span">Convert to a module of…</Text>
              </button>
            )}
            {onRemoveFromModel && (
              <button
                type="button"
                className={[styles.menuItem, styles.menuItemDanger].join(' ')}
                onClick={() => {
                  setMenuOpen(false);
                  onRemoveFromModel();
                }}
              >
                <Text as="span">Remove from model…</Text>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
