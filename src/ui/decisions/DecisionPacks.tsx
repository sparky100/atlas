import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { freezeDecisionPack, listDecisionPacks } from '../../db/decisions';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';
import styles from './DecisionPacks.module.css';

export interface DecisionPacksProps {
  decisionId: UUID;
  canFreeze: boolean;
  /** The live model's head commit now, recorded with the pack. */
  commitId: UUID | null;
  /** The decision write-up as it reads right now. */
  buildMarkdown: () => string;
}

/**
 * Phase B3: freeze the decision write-up as a numbered pack, so sign-off
 * is on a fixed record. A later edit never changes a pack; a material change
 * is frozen as the next version. Insert-only (`atlas.freeze_decision_pack`).
 */
export function DecisionPacks({ decisionId, canFreeze, commitId, buildMarkdown }: DecisionPacksProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: packs } = useQuery({ queryKey: queryKeys.decisionPacks(decisionId), queryFn: () => listDecisionPacks(supabase, decisionId) });

  async function freeze() {
    setBusy(true);
    try {
      await freezeDecisionPack(supabase, decisionId, buildMarkdown(), commitId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.decisionPacks(decisionId) });
    } catch (e) {
      reportError("Couldn't freeze the pack", e);
    } finally {
      setBusy(false);
    }
  }

  if (packs === undefined || (packs.length === 0 && !canFreeze)) return null;

  return (
    <Panel data-testid="decision-packs">
      <Text as="h2" size="lg">
        Frozen packs
      </Text>
      <Text as="p" tone="muted" size="sm">
        A pack is this write-up exactly as it reads now, kept as a fixed record for sign-off. Editing the decision later never changes a pack. A material change is frozen as a new version.
      </Text>
      {canFreeze && (
        <Button variant="secondary" disabled={busy} onClick={() => void freeze()}>
          {packs.length === 0 ? 'Freeze a pack' : `Freeze as version ${String((packs[0]?.version ?? 0) + 1)}`}
        </Button>
      )}
      {packs.length > 0 && (
        <ul className={styles.list}>
          {packs.map((pack) => (
            <li key={pack.id}>
              <details>
                <summary>
                  Version {pack.version} — frozen {pack.frozen_at.slice(0, 10)}
                </summary>
                <pre className={styles.body}>{pack.body_markdown}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
