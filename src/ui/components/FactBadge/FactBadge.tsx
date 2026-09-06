import { useEffect, useState } from 'react';
import type { DeltaRow, FactsRow } from '../../../contracts/rows';
import { getSourcesByIds, getSupersessionChain } from '../../../db/elements';
import type { SourceRow } from '../../../db/types';
import { supabase } from '../../supabaseClient';
import { ProvenanceBadge } from '../ProvenanceBadge/ProvenanceBadge';
import { ProvenanceCard } from '../ProvenanceCard/ProvenanceCard';
import styles from './FactBadge.module.css';

export interface FactBadgeProps {
  fact: FactsRow;
  /** Looked up by the caller from a batch fetch (§4.9's paint budget) — never refetched per badge. */
  source: SourceRow | undefined;
}

/**
 * The compact badge (§4.3) plus the full provenance card on hover or
 * focus (§4.3: "one hover away from every value"). The card's
 * supersession chain is fetched lazily, on first hover/focus, not
 * up front for every badge on the page.
 */
export function FactBadge({ fact, source }: FactBadgeProps) {
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<{ deltas: DeltaRow[]; sources: Map<string, SourceRow> } | null>(null);

  useEffect(() => {
    if (!open || chain) return;
    let cancelled = false;
    getSupersessionChain(supabase, fact.delta_id)
      .then(async (deltas) => {
        const sourceIds = [...new Set(deltas.map((d) => d.source_id))];
        const sources = await getSourcesByIds(supabase, sourceIds);
        if (!cancelled) setChain({ deltas, sources });
      })
      .catch(() => {
        // A card that fails to load its chain still shows the badge and
        // the top-level fact fields — not worth surfacing as a page error.
      });
    return () => {
      cancelled = true;
    };
  }, [open, chain, fact.delta_id]);

  return (
    <button
      type="button"
      className={styles.wrapper}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
    >
      <ProvenanceBadge sourceKind={source?.kind ?? 'manual'} date={fact.effective_date ? new Date(fact.effective_date) : new Date(fact.asserted_at)} confidence={fact.confidence} />
      {open && (
        <span className={styles.popover}>
          <ProvenanceCard fact={fact} source={source} supersessionChain={chain?.deltas ?? null} supersessionSources={chain?.sources ?? new Map()} />
        </span>
      )}
    </button>
  );
}
