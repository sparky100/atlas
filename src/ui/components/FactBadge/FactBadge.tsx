import { useEffect, useId, useRef, useState } from 'react';
import type { FactsRow } from '../../../contracts/rows';
import { getCapabilityMap, type CapabilityMapRow } from '../../../db/capabilityMapTemplates';
import { getSourcesByIds, getSupersessionChain } from '../../../db/elements';
import type { SourceRow } from '../../../db/types';
import { supabase } from '../../supabaseClient';
import { Button } from '../Button/Button';
import { ProvenanceBadge } from '../ProvenanceBadge/ProvenanceBadge';
import { ProvenanceCard, type FactHistory } from '../ProvenanceCard/ProvenanceCard';
import { Text } from '../Text/Text';
import styles from './FactBadge.module.css';

export interface FactBadgeProps {
  label: string;
  fact: FactsRow;
  /** Loaded by the caller in a batch with the other current sources. */
  source: SourceRow | undefined;
}

export function FactBadge(props: FactBadgeProps) {
  // A replacement fact has a different chain, even in the same attribute row.
  return <FactEvidence key={props.fact.delta_id} {...props} />;
}

function FactEvidence({ label, fact, source }: FactBadgeProps) {
  const panelId = useId();
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [requested, setRequested] = useState(false);
  const [history, setHistory] = useState<FactHistory>({ status: 'loading' });
  const [seededFrom, setSeededFrom] = useState<{ id: string; map: CapabilityMapRow } | null>(null);
  const mapId = source?.capability_map_id;

  useEffect(() => {
    if (!requested || history.status !== 'loading') return;
    let cancelled = false;
    async function loadHistory() {
      const chain = await getSupersessionChain(supabase, fact.delta_id);
      const deltas = chain.filter((delta) => delta.id !== fact.delta_id);
      const ids = [...new Set(deltas.map((delta) => delta.source_id))];
      const sources = await getSourcesByIds(supabase, ids);
      if (!cancelled) setHistory({ status: 'ready', deltas, sources });
    }
    void loadHistory().catch((error: unknown) => {
      if (cancelled) return;
      console.error('Could not load fact history.', error);
      setHistory({ status: 'error' });
    });
    return () => { cancelled = true; };
  }, [fact.delta_id, history.status, requested]);

  useEffect(() => {
    if (!requested || !mapId) return;
    let cancelled = false;
    void getCapabilityMap(supabase, mapId).then((map) => {
      if (!cancelled && map) setSeededFrom({ id: mapId, map });
    }).catch((error: unknown) => {
      if (!cancelled) console.error('Could not load the source capability map.', error);
    });
    return () => { cancelled = true; };
  }, [mapId, requested]);

  const heading = `Evidence for ${label}`;
  return (
    <>
      <button type="button" className={styles.trigger} popoverTarget={panelId} aria-label={heading} aria-haspopup="dialog">
        <ProvenanceBadge sourceKind={source?.kind ?? 'manual'} date={new Date(fact.effective_date ?? fact.asserted_at)} />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={styles.popover}
        onToggle={(event) => {
          const panel = event.currentTarget;
          const isOpen = panel.matches(':popover-open');
          setOpened(isOpen);
          if (isOpen) {
            setRequested(true);
            panel.focus({ preventScroll: true });
          }
        }}
      >
        <div className={styles.header}>
          <Text id={headingId} size="md">{heading}</Text>
          <Button variant="ghost" popoverTarget={panelId} popoverTargetAction="hide">Close</Button>
        </div>
        {opened && (
          <ProvenanceCard
            fact={fact}
            source={source}
            history={history}
            seededFrom={seededFrom && seededFrom.id === mapId ? seededFrom.map : null}
            onRetryHistory={() => {
              panelRef.current?.focus({ preventScroll: true });
              setHistory({ status: 'loading' });
            }}
          />
        )}
      </div>
    </>
  );
}
