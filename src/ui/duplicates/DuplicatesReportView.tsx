/**
 * F4 (ADR-019 "Amended (F4, ...)"): the duplicates report itself — a
 * "Check now" button plus a nightly-sweep toggle (owner/architect only,
 * `canManageDuplicatesCheck`), and every open candidate pair with its
 * score/signal badges read straight off `duplicate_candidates.signals`
 * (never a second, hand-computed approximation of what the RPC already
 * decided). Mirrors `CaptureJobListView.tsx`'s shape (a create-ish action
 * gated by role, loading/empty states, a list of rows).
 *
 * v1 scope call (ADR-019 "Amended (F4, ...)"): the report is main-scoped,
 * and only main's own edit gate (`canEditOnMain`) can merge there — so a
 * contributor sees "Not a duplicate" but never "Merge into…", which is
 * omitted entirely for them, not shown disabled (this codebase's own
 * convention everywhere else a role gate hides an action).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { MemberRole } from '../../db/types';
import { getElementsByIds } from '../../db/elements';
import { setDuplicatesCheckEnabled } from '../../db/duplicates';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { canManageDuplicatesCheck, canRunDuplicateCheck } from '../orgs/useMembership';
import { supabase } from '../supabaseClient';
import { formatRelativeTime } from '../time';
import { mergePrefillToSearchParams } from './mergePrefill';
import { useDuplicateCheck } from './useDuplicateCheck';
import styles from './DuplicatesReportView.module.css';

export interface DuplicatesReportViewProps {
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
  /** Main's own current head — the report's own read scope (ADR-019: not ref-scoped, same convention `CaptureJobListPage.tsx`/`useArchitectHomeInsights.ts` already use for "model-wide"), and what element names are resolved against. */
  searchCommitId: UUID;
  /** `models.duplicates_check_enabled`'s current value — the toggle's own starting state; this view owns it optimistically from here (`ModelSettingsPage.tsx`'s full-reload convention is overkill for one checkbox on a report page). */
  duplicatesCheckEnabled: boolean;
  role: MemberRole | null;
}

interface DuplicateSignals {
  sharedOwner: boolean;
  sharedVendor: boolean;
  sharedParent: boolean;
  sharedDescription: boolean;
  neighbourOverlapCount: number;
}

function signalBadges(signals: Record<string, unknown>): string[] {
  const s = signals as Partial<DuplicateSignals>;
  const badges: string[] = [];
  if (s.sharedOwner) badges.push('Shared owner');
  if (s.sharedVendor) badges.push('Shared vendor');
  if (s.sharedParent) badges.push('Shared parent');
  if (s.sharedDescription) badges.push('Shared description');
  if (typeof s.neighbourOverlapCount === 'number' && s.neighbourOverlapCount > 0) {
    badges.push(`${String(s.neighbourOverlapCount)} shared neighbour${s.neighbourOverlapCount === 1 ? '' : 's'}`);
  }
  return badges;
}

export function DuplicatesReportView({ modelId, orgSlug, modelSlug, searchCommitId, duplicatesCheckEnabled, role }: DuplicatesReportViewProps) {
  const { status, candidates, latestRun, error, checkNow, dismiss } = useDuplicateCheck(modelId);
  const [elementsById, setElementsById] = useState<Map<UUID, ElementsHeadRow>>(new Map());
  const [checkEnabled, setCheckEnabled] = useState(duplicatesCheckEnabled);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const canRun = canRunDuplicateCheck(role);
  const canManage = canManageDuplicatesCheck(role);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(candidates.flatMap((c) => [c.element_a_id, c.element_b_id]))];
    // No candidates yet (or none left) — nothing to resolve; `elementsById`
    // is only ever read through `candidates.map`, so a stale, unused map
    // left over from before the last candidate was dismissed is harmless.
    if (ids.length === 0) return undefined;
    getElementsByIds(supabase, searchCommitId, ids)
      .then((map) => {
        if (!cancelled) setElementsById(map);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the elements in this report.", e);
      });
    return () => {
      cancelled = true;
    };
  }, [candidates, searchCommitId]);

  const handleToggle = (checked: boolean) => {
    setCheckEnabled(checked);
    setToggleError(null);
    void setDuplicatesCheckEnabled(supabase, modelId, checked).catch((e: unknown) => {
      setCheckEnabled(!checked);
      const message = e instanceof Error ? e.message : 'Could not update the nightly check setting.';
      setToggleError(message);
      reportError("Couldn't update the nightly check setting.", e);
    });
  };

  const elementHref = (elementId: UUID) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}`;
  const mergeHref = (survivorId: UUID, survivorName: string, loserId: UUID) => `${elementHref(loserId)}?${mergePrefillToSearchParams({ targetId: survivorId, targetName: survivorName }).toString()}`;

  return (
    <div>
      <div className={styles.header}>
        <Text as="h2" size="lg">
          Duplicate candidates
        </Text>
        {canRun && (
          <Button
            variant="primary"
            onClick={checkNow}
            disabled={status === 'checking' || latestRun?.status === 'running'}
          >
            {status === 'checking' || latestRun?.status === 'running' ? 'Checking…' : 'Check now'}
          </Button>
        )}
      </div>

      {latestRun && (
        <Text as="p" tone="muted" size="sm">
          {latestRun.status === 'running' && 'Check in progress…'}
          {latestRun.status === 'succeeded' && latestRun.finished_at && `Last checked ${formatRelativeTime(latestRun.finished_at, new Date())} — ${String(latestRun.candidate_count ?? 0)} candidate${latestRun.candidate_count === 1 ? '' : 's'} found.`}
          {latestRun.status === 'failed' && `Last check failed: ${latestRun.error ?? 'unknown error'}.`}
        </Text>
      )}

      {canManage && (
        <Panel>
          <label>
            <input
              type="checkbox"
              checked={checkEnabled}
              onChange={(e) => {
                handleToggle(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Run this check automatically every night
            </Text>
          </label>
          {toggleError !== null && (
            <Text as="p" size="sm">
              {toggleError}
            </Text>
          )}
        </Panel>
      )}

      {!canRun && (
        <Panel>
          <Text as="p" size="sm">
            The duplicates report finds elements that are probably the same real thing — a name match plus corroborating signals like a shared owner or overlapping relationships. Nothing changes on main until someone merges or dismisses a pair.
          </Text>
        </Panel>
      )}

      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}

      {status === 'loading' && candidates.length === 0 && <Text tone="muted">Loading…</Text>}
      {candidates.length === 0 && status !== 'loading' && <EmptyState>No duplicate candidates right now.</EmptyState>}

      <ul className={styles.list}>
        {candidates.map((candidate) => {
          const elementA = elementsById.get(candidate.element_a_id);
          const elementB = elementsById.get(candidate.element_b_id);
          const nameA = elementA?.name ?? candidate.element_a_id;
          const nameB = elementB?.name ?? candidate.element_b_id;
          const badges = signalBadges(candidate.signals);
          return (
            <li key={candidate.id} className={styles.row}>
              <div className={styles.rowMain}>
                <Text as="span" size="lg">
                  <Link to={elementHref(candidate.element_a_id)}>{nameA}</Link> ↔ <Link to={elementHref(candidate.element_b_id)}>{nameB}</Link>
                </Text>
                <div className={styles.rowMeta}>
                  <Chip tone="info">{Math.round(candidate.score * 100)}% match</Chip>
                  <Chip tone="neutral">{candidate.element_type}</Chip>
                  {badges.map((badge) => (
                    <Chip key={badge} tone="neutral">
                      {badge}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className={styles.rowActions}>
                {canManage && (
                  <>
                    <Link to={mergeHref(candidate.element_a_id, nameA, candidate.element_b_id)}>
                      <Text as="span" size="sm">
                        Merge into {nameA}
                      </Text>
                    </Link>
                    <Link to={mergeHref(candidate.element_b_id, nameB, candidate.element_a_id)}>
                      <Text as="span" size="sm">
                        Merge into {nameB}
                      </Text>
                    </Link>
                  </>
                )}
                {canRun && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      dismiss(candidate.element_a_id, candidate.element_b_id);
                    }}
                  >
                    Not a duplicate
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
