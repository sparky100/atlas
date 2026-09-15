import { useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { loadDerivedReviewers } from '../../db/deriveReviewers';
import { listMembers } from '../../db/organisations';
import type { ReviewerInput } from '../../db/reviewVerdicts';
import type { BranchRow } from '../../db/types';
import { profileLabel } from '../comments/profileLabel';
import { reportError } from '../errors/errorBannerStore';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import styles from './ReviewerPicker.module.css';

interface PickerMember {
  userId: UUID;
  label: string;
}

export interface ReviewerPickerProps {
  orgId: UUID;
  modelId: UUID;
  branch: BranchRow;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (reviewers: ReviewerInput[]) => void;
}

/**
 * F3a's submit-side reviewer picker: lists every org member, pre-checking
 * the derived set (owners mapped through their actors' `memberId` + one
 * architect) as required reviewers. The proposer checks/unchecks members to
 * add or remove them, and can toggle each selected member's `required` flag
 * — the server still enforces the org's architect floor on submit.
 */
export function ReviewerPicker({ orgId, modelId, branch, submitting, onCancel, onSubmit }: ReviewerPickerProps) {
  const [members, setMembers] = useState<PickerMember[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<UUID, boolean>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMembers(supabase, orgId), loadDerivedReviewers(supabase, modelId, orgId, branch)])
      .then(([memberList, derived]) => {
        if (cancelled) return;
        setMembers(memberList.map((m) => ({ userId: m.member.user_id, label: m.profile ? profileLabel(m.profile) : m.member.user_id })));
        setSelected(new Map(derived.map((d) => [d.userId, d.required])));
        setStatus('ready');
      })
      .catch((e: unknown) => {
        reportError("Couldn't load reviewers.", e);
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Failed to load reviewers.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, modelId, branch]);

  const chosen = useMemo<ReviewerInput[]>(() => [...selected.entries()].map(([userId, required]) => ({ userId, required })), [selected]);

  function toggle(userId: UUID) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) next.delete(userId);
      else next.set(userId, false);
      return next;
    });
  }

  function toggleRequired(userId: UUID) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) next.set(userId, !next.get(userId));
      return next;
    });
  }

  if (status === 'loading') return <Text tone="muted">Loading reviewers…</Text>;
  if (status === 'error') return <Text as="p">{error}</Text>;

  return (
    <Panel>
      <Text as="p" tone="muted" size="sm">
        Required reviewers must approve before this change merges; optional ones may abstain.
      </Text>
      <ul className={styles.list}>
        {members.map((m) => {
          const isSelected = selected.has(m.userId);
          const required = selected.get(m.userId) === true;
          return (
            <li key={m.userId} className={styles.row}>
              <label className={styles.member}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {
                    toggle(m.userId);
                  }}
                />
                <Text as="span">{m.label}</Text>
              </label>
              {isSelected && (
                <label className={styles.required}>
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={() => {
                      toggleRequired(m.userId);
                    }}
                  />
                  <Text as="span" size="sm" tone="muted">
                    required
                  </Text>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={submitting || chosen.length === 0}
          onClick={() => {
            onSubmit(chosen);
          }}
        >
          {submitting ? 'Submitting…' : 'Submit for review'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}
