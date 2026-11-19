import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { freezeDecisionPack, listDecisionApprovals, listDecisionPacks, recordDecisionApproval } from '../../db/decisions';
import { DECISION_APPROVAL_LENSES, type DecisionApprovalLens, type DecisionApprovalVerdict } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';
import { LENS_LABELS, lensesOpenTo, packIsStale, packSignOff, packSignOffSummary } from './packSignOff';
import styles from './DecisionPacks.module.css';

export interface DecisionPacksProps {
  decisionId: UUID;
  canFreeze: boolean;
  /** Owner or architect: may approve or decline the latest pack. */
  canSign: boolean;
  userId: UUID | null;
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
export function DecisionPacks({ decisionId, canFreeze, canSign, userId, commitId, buildMarkdown }: DecisionPacksProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [lens, setLens] = useState<DecisionApprovalLens | ''>('');
  const [comment, setComment] = useState('');
  const { data: approvals } = useQuery({ queryKey: queryKeys.decisionApprovals(decisionId), queryFn: () => listDecisionApprovals(supabase, decisionId) });
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

  async function sign(packId: UUID, verdict: DecisionApprovalVerdict, chosenLens: DecisionApprovalLens) {
    setBusy(true);
    try {
      await recordDecisionApproval(supabase, { packId, lens: chosenLens, verdict, comment: comment.trim() });
      setLens('');
      setComment('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.decisionApprovals(decisionId) });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message.includes('cannot sign it')) reportError('You froze this pack, so someone else has to sign it.', e);
      else if (message.includes('not the latest')) reportError('A newer version of this pack exists, so this one can no longer be signed.', e);
      else reportError("Couldn't record the sign-off", e);
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
        A pack is this write-up exactly as it reads now, kept as a fixed record for sign-off. Owners and architects can approve or decline the latest version, as a capacity they state (a label, not a checked role). You can't sign a pack you froze yourself. Editing the decision later never changes a pack: a material change is frozen as a new version and needs fresh sign-off.
      </Text>
      {canFreeze && (
        <Button variant="secondary" disabled={busy} onClick={() => void freeze()}>
          {packs.length === 0 ? 'Freeze a pack' : `Freeze as version ${String((packs[0]?.version ?? 0) + 1)}`}
        </Button>
      )}
      {packs.length > 0 && (
        <ul className={styles.list}>
          {packs.map((pack, index) => {
            const own = (approvals ?? []).filter((a) => a.pack_id === pack.id);
            const isLatest = index === 0;
            const open = lensesOpenTo(userId, pack.id, approvals ?? [], DECISION_APPROVAL_LENSES);
            const stale = isLatest && packIsStale(pack.body_markdown, buildMarkdown());
            const selected = lens !== '' && open.includes(lens) ? lens : '';
            return (
              <li key={pack.id}>
                <details>
                  <summary>
                    Version {pack.version} — frozen {pack.frozen_at.slice(0, 10)} — {packSignOffSummary(packSignOff(pack.id, approvals ?? []))}
                    {stale ? ' — the decision has changed since this was frozen' : ''}
                  </summary>
                  <pre className={styles.body}>{pack.body_markdown}</pre>
                </details>
                {own.length > 0 && (
                  <ul className={styles.signOffs} aria-label={`Sign-offs on version ${String(pack.version)}`}>
                    {own.map((a) => (
                      <li key={a.id}>
                        {LENS_LABELS[a.lens]}: {a.verdict === 'approve' ? 'approved' : 'declined'} on {a.decided_at.slice(0, 10)}
                        {a.comment !== '' ? ` — ${a.comment}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {isLatest && canSign && open.length > 0 && (
                  <div className={styles.signForm} role="group" aria-label={`Sign off version ${String(pack.version)}`}>
                    <label>
                      Signing as
                      <select value={selected} onChange={(e) => { setLens(e.target.value as DecisionApprovalLens | ''); }}>
                        <option value="">Pick a capacity…</option>
                        {open.map((l) => (
                          <option key={l} value={l}>
                            {LENS_LABELS[l]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Comment (optional)
                      <textarea rows={2} value={comment} maxLength={4000} onChange={(e) => { setComment(e.target.value); }} />
                    </label>
                    <div className={styles.signButtons}>
                      <Button variant="primary" disabled={busy || selected === ''} onClick={() => { if (selected !== '') void sign(pack.id, 'approve', selected); }}>
                        Approve this version
                      </Button>
                      <Button variant="secondary" disabled={busy || selected === ''} onClick={() => { if (selected !== '') void sign(pack.id, 'decline', selected); }}>
                        Decline this version
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
