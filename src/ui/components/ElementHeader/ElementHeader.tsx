import { useState } from 'react';
import type { ElementsHeadRow } from '../../../contracts/rows';
import type { AliasRow, SourceRow } from '../../../db/types';
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
  aliases: AliasRow[];
  aliasSources: Map<string, SourceRow>;
  /**
   * `Edit` (§4.2), shown only when the caller has already established both
   * halves of its gate: owner/architect role (ADR-015) and `ref === main`
   * (a tag is never editable, and Sprint U1 has no `Propose a change…` to
   * open for anyone else — no branch UI yet). Omitted entirely otherwise,
   * not shown disabled: CLAUDE.md rule 7 rules out a button with nothing
   * behind it.
   */
  onEdit?: (() => void) | undefined;
}

/**
 * The identity header (§4.2). `Propose a change…` (the contributor path at
 * `main`/a tag) still isn't built — there is no branch UI yet — so `Edit`
 * only ever appears for the one role/ref combination Sprint U1 actually
 * supports: owner/architect, at `main` (ADR-015).
 */
export function ElementHeader({ element, existsFact, existsSource, aliases, aliasSources, onEdit }: ElementHeaderProps) {
  const [copied, setCopied] = useState(false);
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
        <button type="button" className={styles.idButton} onClick={() => void copyId()}>
          <Text mono size="sm" tone="muted" as="span">
            {element.element_id.slice(0, 8)}…
          </Text>
          <Text size="sm" tone="muted" as="span">
            {copied ? 'copied' : '⧉'}
          </Text>
        </button>
        {existsFact && <FactBadge fact={existsFact} source={existsSource} />}
        {/*
          Aliases aren't `facts` rows (no delta_id — SPEC §3.6's aliases
          table stands apart from the delta/fact stream), so FactBadge's
          own "supersession chain" concept doesn't really apply to one.
          Reusing FactBadge here for its compact source+confidence display
          is a deliberate simplification: the badge's hover chain will
          just come back empty (delta_id doesn't resolve to a real delta),
          which is honest — an alias has no supersession chain — not a bug
          to route around with a second, near-identical badge component.
        */}
        {aliases.map((alias) => (
          <span key={alias.id} className={styles.alias}>
            <Text tone="muted" size="sm" as="span">
              aka "{alias.alias_value}"
            </Text>
            <FactBadge
              fact={{
                subject_type: 'element',
                subject_id: element.element_id,
                attribute: `alias:${alias.alias_type}`,
                value: alias.alias_value,
                delta_id: alias.id,
                source_id: alias.source_id,
                source_ref: null,
                effective_date: null,
                confidence: alias.confidence,
                asserted_by: alias.created_by,
                asserted_at: alias.created_at,
              }}
              source={aliasSources.get(alias.source_id)}
            />
          </span>
        ))}
        {onEdit && (
          <Button variant="ghost" onClick={onEdit}>
            ✎ Edit
          </Button>
        )}
      </div>
    </header>
  );
}
