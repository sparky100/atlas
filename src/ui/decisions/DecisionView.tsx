import { useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import { useMainBranch } from '../branches/useMainBranch';
import type { MemberRole } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';
import { profileLabel } from '../comments/profileLabel';
import { canChooseDecisionOption, canCreateChangeBranch, canRateDecisionOption } from '../orgs/useMembership';
import { useMembers } from '../orgs/useMembers';
import type { AlsoAffectedElement } from './alsoAffected';
import { DecisionCriteriaGrid, type DecisionCriteriaOption } from './DecisionCriteriaGrid';
import { decisionStatusTone } from './decisionStatus';
import { exportDecisionAsAdrMarkdown } from './exportDecisionAsAdr';
import type { DecisionPageState } from './useDecision';
import { useDecisionComparison, type DecisionComparisonOption } from './useDecisionComparison';
import { useDecisionOptions } from './useDecisionOptions';
import { groupWhatChangesRows, type WhatChangesRow } from './whatChangesRows';
import styles from './DecisionView.module.css';

export interface DecisionViewProps {
  modelId: UUID;
  decisionId: UUID;
  orgId: UUID;
  orgSlug: string;
  modelSlug: string;
  role: MemberRole | null;
  /** Lifted from `DecisionPage.tsx`'s own `useDecision` call, not fetched again here — the two used to each run their own independent copy of the same fetch (one for this view, one `DecisionPage.tsx` only ever read `.title` from), so a transient failure of either one alone could post the "Couldn't load this decision" banner even while the other succeeded and rendered full content underneath it (found in a walkthrough, issue-reported). One fetch, one `reload`, shared. */
  state: DecisionPageState;
  reload: () => void;
}

/**
 * A single decision's own page (prompt pack F3). PR4 built context/owner/
 * needed-by, its links, and comments; PR5 added "Add an option" (a fresh
 * `explore`-intent branch, linked), the comparison table
 * (`compareOptions.ts` — each option's own folded state re-run through
 * the existing capability-map metrics and boundary-crossing finding,
 * diffed against main), and "Choose" (`atlas.choose_decision_option` in
 * one call). PR6 adds "Copy as ADR markdown" (`exportDecisionAsAdr.ts` —
 * a pure string-template builder, copied to the clipboard the same way
 * `ElementHeader.tsx`'s own "Copy element ID" already does, since nothing
 * in this app has ever offered a file download to invent a second
 * mechanism for). "Start a decision" from a health finding and "why is
 * this here" (an element's own linked decisions) are also PR6, but live on
 * `DecisionsView.tsx`/`ElementDecisionsSection.tsx` respectively, not here.
 */
export function DecisionView({ modelId, decisionId, orgId, orgSlug, modelSlug, role, state, reload }: DecisionViewProps) {
  const { userId } = useAuth();
  const { branch: main } = useMainBranch(modelId);
  const { members } = useMembers(orgId);
  const optionsState = useDecisionOptions(reload);

  const [addingOption, setAddingOption] = useState(false);
  const [optionName, setOptionName] = useState('');
  const [optionTitle, setOptionTitle] = useState('');
  const [choosingBranchId, setChoosingBranchId] = useState<UUID | null>(null);
  const [reasons, setReasons] = useState('');
  const [adrCopied, setAdrCopied] = useState(false);
  const [whatChangesExpanded, setWhatChangesExpanded] = useState(false);

  // Every hook above must run unconditionally (rules of hooks) — the
  // comparison hook too, even before `state` has resolved to `ready`;
  // it degrades to its own `'empty'` state on an empty/not-yet-loaded input.
  const readyState = state.status === 'ready' ? state : null;
  const elementLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship') : [];
  const branchLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'branch') : [];
  const concernedCapabilityIds = readyState ? elementLinks.map((l) => l.linked_id).filter((id) => readyState.linkedElementsById.get(id)?.element_type === 'capability') : [];
  // F6.3 (Part B) rule 5: a system/container concern gets its own outcome
  // row (unchanged/retired/replaced by X) alongside a capability concern's
  // four metric rows — a distinct id list, since the two never share a
  // row shape.
  const otherConcernElementIds = readyState ? elementLinks.map((l) => l.linked_id).filter((id) => { const t = readyState.linkedElementsById.get(id)?.element_type; return t === 'system' || t === 'container'; }) : [];
  const comparisonOptions: DecisionComparisonOption[] = readyState
    ? branchLinks
        .map((l) => readyState.linkedBranchesById.get(l.linked_id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined)
        .map((b) => ({ branchId: b.id, baseCommitId: b.base_commit_id, headCommitId: b.head_commit_id, label: intentHeaderLine(b) }))
    : [];
  const comparison = useDecisionComparison(modelId, main?.head_commit_id ?? null, concernedCapabilityIds, otherConcernElementIds, comparisonOptions);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'not_found') return <Text as="p">No decision found for this id.</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const { decision, linkedElementsById, linkedBranchesById, args } = state;
  const canAddOption = canCreateChangeBranch(role) && decision.status === 'proposed';
  const canChoose = canChooseDecisionOption(role) && decision.status === 'proposed';
  const canRate = canRateDecisionOption(role, decision);

  // Prompt pack F3 PR6's "Export as ADR markdown" — assembled from data
  // this page has already loaded (no second round trip). `decisionArgLinks`
  // filters to the `stance: 'for'` row `atlas.choose_decision_option`
  // itself writes (PR5); `null` until the decision is `accepted`, the same
  // "not yet decided" honesty `exportDecisionAsAdrMarkdown` itself renders.
  const ownerName = profileLabel(members.find((m) => m.member.user_id === decision.owner_id)?.profile);
  // Distinct from the `reasons`/`setReasons` state above, which is the
  // in-progress "Choose" confirm form's own textarea — this is the
  // decision's own already-recorded `decision_arguments` row, once it has one.
  const decidedReasons = args.find((a) => a.stance === 'for')?.body ?? null;

  async function copyAdrMarkdown() {
    const markdown = exportDecisionAsAdrMarkdown({
      decision,
      ownerName,
      options: branchLinks
        .map((l) => linkedBranchesById.get(l.linked_id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined)
        .map((b) => ({ branch: b, isChosen: b.id === decision.branch_id })),
      reasons: decidedReasons,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setAdrCopied(true);
      setTimeout(() => {
        setAdrCopied(false);
      }, 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // not worth surfacing as an error for a copy-to-clipboard nicety,
      // same call `ElementHeader.tsx`'s own "Copy element ID" makes.
    }
  }

  return (
    <div>
      <div className={styles.meta}>
        <Chip tone={decisionStatusTone(decision.status)}>{decision.status}</Chip>
        {decision.needed_by !== null && (
          <Text as="span" tone="muted" size="sm">
            Needed by: {decision.needed_by}
          </Text>
        )}
        {decision.lens_map_url !== null && (
          <a href={decision.lens_map_url} target="_blank" rel="noreferrer">
            <Text as="span" size="sm">
              Lens map →
            </Text>
          </a>
        )}
        <Button variant="ghost" onClick={() => void copyAdrMarkdown()}>
          {adrCopied ? 'Copied' : 'Copy as ADR markdown'}
        </Button>
      </div>

      <Panel>
        <div className={styles.field}>
          <Text as="h2" size="lg">
            Context
          </Text>
          <Text as="p" tone={decision.statement ? 'default' : 'muted'}>
            {decision.statement || 'No context recorded.'}
          </Text>
        </div>
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Concerns
        </Text>
        {elementLinks.length === 0 ? (
          <EmptyState>No capabilities or systems linked yet.</EmptyState>
        ) : (
          <ul className={styles.linkList}>
            {elementLinks.map((link) => {
              const element = linkedElementsById.get(link.linked_id);
              return (
                <li key={link.linked_id} className={styles.linkRow}>
                  {element ? (
                    <>
                      <ElementTypeGlyph type={element.element_type} />
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${element.element_id}`}>
                        <Text as="span">{element.name}</Text>
                      </Link>
                    </>
                  ) : (
                    <Text as="span" tone="muted" size="sm">
                      A linked element that no longer resolves on main.
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Criteria
        </Text>
        {branchLinks.length === 0 ? (
          <EmptyState>No options added yet.</EmptyState>
        ) : (
          (() => {
            const criteriaOptions: DecisionCriteriaOption[] = branchLinks
              .map((link) => linkedBranchesById.get(link.linked_id))
              .filter((b): b is NonNullable<typeof b> => b !== undefined)
              .map((b) => ({
                branchId: b.id,
                label: intentHeaderLine(b),
                status: b.status,
                isChosen: decision.branch_id === b.id,
                summary: comparison.status === 'ready' ? (comparison.optionSummaries.get(b.id) ?? null) : null,
                canChoose: canChoose && b.status === 'draft',
              }));
            return (
              <DecisionCriteriaGrid
                modelId={modelId}
                decisionId={decisionId}
                options={criteriaOptions}
                canRate={canRate}
                userId={userId}
                neededBy={decision.needed_by}
                orgSlug={orgSlug}
                modelSlug={modelSlug}
                onChoose={(branchId) => {
                  setChoosingBranchId(branchId);
                  setReasons('');
                }}
              />
            );
          })()
        )}
        {branchLinks.some((link) => !linkedBranchesById.get(link.linked_id)) && (
          <Text as="p" tone="muted" size="sm">
            A linked change that no longer resolves.
          </Text>
        )}

        {choosingBranchId !== null && (
          <div className={styles.field}>
            <Text as="label" size="sm" tone="muted">
              Why this option
            </Text>
            <textarea
              className={styles.textarea}
              placeholder="The reasons this option was chosen over the others"
              value={reasons}
              onChange={(e) => {
                setReasons(e.target.value);
              }}
            />
            <div className={styles.addOptionForm}>
              <Button
                variant="primary"
                disabled={optionsState.status === 'choosing' || reasons.trim().length === 0}
                onClick={() => {
                  void optionsState.chooseOption(decisionId, choosingBranchId, reasons).then((chosen) => {
                    if (chosen) setChoosingBranchId(null);
                  });
                }}
              >
                {optionsState.status === 'choosing' ? 'Choosing…' : 'Confirm choice'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setChoosingBranchId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {canAddOption && !addingOption && (
          <Button
            variant="secondary"
            onClick={() => {
              setAddingOption(true);
              setOptionName('');
              setOptionTitle('');
            }}
          >
            + Add an option
          </Button>
        )}
        {canAddOption && addingOption && (
          <div className={styles.addOptionForm}>
            <input
              className={styles.input}
              type="text"
              placeholder="Name (e.g. replace-with-workday)"
              value={optionName}
              onChange={(e) => {
                setOptionName(e.target.value);
              }}
            />
            <input
              className={styles.input}
              type="text"
              placeholder="Title (e.g. Replace with Workday)"
              value={optionTitle}
              onChange={(e) => {
                setOptionTitle(e.target.value);
              }}
            />
            <Button
              variant="primary"
              disabled={optionsState.status === 'adding' || optionName.trim().length === 0}
              onClick={() => {
                if (!userId) return;
                void optionsState.addOption({ orgId, modelId, decisionId, name: optionName, title: optionTitle, userId }).then((added) => {
                  if (added) setAddingOption(false);
                });
              }}
            >
              {optionsState.status === 'adding' ? 'Adding…' : 'Add option'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAddingOption(false);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        {optionsState.error !== null && <Text as="p">{optionsState.error}</Text>}
      </Panel>

      {comparisonOptions.length > 0 && (
        <Panel>
          <div className={styles.meta}>
            <Text as="h2" size="lg">
              What changes
            </Text>
            {comparison.status === 'ready' && (
              <Text as="span" size="sm" tone="muted">
                Boundary crossings (model-wide): {comparison.main.boundaryCrossingCount}
              </Text>
            )}
          </div>

          {comparison.status === 'loading' && (
            <Text as="p" tone="muted" size="sm">
              Comparing…
            </Text>
          )}
          {comparison.status === 'error' && <Text as="p">{comparison.message}</Text>}

          {comparison.status === 'ready' &&
            (() => {
              const { visible, collapsed } = groupWhatChangesRows(comparison.whatChangesRows);
              const visibleGroups = groupConsecutiveByLabel(visible);
              // `OptionComparisonRow.branchId` is `UUID | null` only because the type is shared with the "Current (main)" row — every row in `comparison.options` always has a real branch id.
              const optionBranchIds = comparison.options.map((o) => o.branchId).filter((id): id is UUID => id !== null);
              return (
                <>
                  {visible.length === 0 ? (
                    <Text as="p">These options don't change the structure of anything in scope.</Text>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.comparisonTable}>
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>{comparison.main.label}</th>
                            {comparison.options.map((o) => (
                              <th key={o.branchId}>{o.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleGroups.map((group) => (
                            <WhatChangesRowGroup key={group.groupLabel} group={group} optionBranchIds={optionBranchIds} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {collapsed.length > 0 && (
                    <div className={styles.field}>
                      <button
                        type="button"
                        className={styles.collapsedToggle}
                        onClick={() => {
                          setWhatChangesExpanded((e) => !e);
                        }}
                      >
                        {collapsed.length} row{collapsed.length === 1 ? '' : 's'} unchanged in all options {whatChangesExpanded ? '▲' : '▼'}
                      </button>
                      {whatChangesExpanded && (
                        <div className={styles.tableWrap}>
                          <table className={styles.comparisonTable}>
                            <tbody>
                              {groupConsecutiveByLabel(collapsed).map((group) => (
                                <WhatChangesRowGroup key={group.groupLabel} group={group} optionBranchIds={optionBranchIds} />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {comparison.options.map((o) => {
                    if (o.branchId === null) return null;
                    const alsoAffected = comparison.alsoAffectedByBranchId.get(o.branchId) ?? [];
                    if (alsoAffected.length === 0) return null;
                    return (
                      <div key={o.branchId} className={styles.field}>
                        <Text as="h3" size="sm">
                          Also affected — {o.label}
                        </Text>
                        <ul className={styles.linkList}>
                          {alsoAffected.map((a: AlsoAffectedElement) => {
                            const owners = [...a.ownersByRole.entries()].flatMap(([role, list]) => list.map((owner) => `${owner.name} (${role})`));
                            return (
                              <li key={a.element.element_id} className={styles.linkRow}>
                                <ElementTypeGlyph type={a.element.element_type} />
                                <Link to={`/o/${orgSlug}/m/${modelSlug}/e/${a.element.element_id}`}>
                                  <Text as="span">{a.element.name}</Text>
                                </Link>
                                {owners.length > 0 && (
                                  <Text as="span" size="sm" tone="muted">
                                    Owned by {owners.join(', ')}
                                  </Text>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </>
              );
            })()}
        </Panel>
      )}

      <Panel>
        <Text as="h2" size="lg">
          Arguments
        </Text>
        {args.length === 0 ? (
          <EmptyState>No arguments recorded yet — recorded once this decision is chosen.</EmptyState>
        ) : (
          <ul className={styles.linkList}>
            {args.map((arg) => (
              <li key={arg.id} className={styles.linkRow}>
                <Chip tone={arg.stance === 'for' ? 'ok' : arg.stance === 'against' ? 'danger' : 'neutral'}>{arg.stance}</Chip>
                <Text as="span" size="sm">
                  {arg.body}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <Text as="h2" size="lg">
          Comments
        </Text>
        <CommentsSection orgId={orgId} modelId={modelId} userId={userId} role={role} anchorType="decision" anchorId={decisionId} branchId={null} />
      </Panel>
    </div>
  );
}

interface WhatChangesRowGroupData {
  groupLabel: string;
  rows: WhatChangesRow[];
}

/**
 * F6.3 (Part B) rendering-only grouping — chunks consecutive rows sharing
 * the same `groupLabel` (decision 2: "group visible rows under the
 * capability name") so the table shows the group name once, not once per
 * metric row. `buildWhatChangesRows` already emits same-group rows
 * consecutively; filtering out unchanged rows (`groupWhatChangesRows`)
 * never interleaves two different groups, only shrinks a run, so this
 * stays correct after that filter too. No comparison logic of its own —
 * every row's own `changed`/`display` value was already decided by
 * `whatChangesRows.ts`.
 */
function groupConsecutiveByLabel(rows: readonly WhatChangesRow[]): WhatChangesRowGroupData[] {
  const groups: WhatChangesRowGroupData[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last?.groupLabel === row.groupLabel) last.rows.push(row);
    else groups.push({ groupLabel: row.groupLabel, rows: [row] });
  }
  return groups;
}

function WhatChangesRowGroup({ group, optionBranchIds }: { group: WhatChangesRowGroupData; optionBranchIds: readonly UUID[] }) {
  const showGroupHeader = group.rows.length > 1 || group.rows[0]?.rowLabel !== group.groupLabel;
  return (
    <>
      {showGroupHeader && (
        <tr>
          <td colSpan={99}>
            <Text as="span" size="sm" tone="muted">
              {group.groupLabel}
            </Text>
          </td>
        </tr>
      )}
      {group.rows.map((row) => (
        <tr key={row.id}>
          <td>{showGroupHeader ? row.rowLabel : row.groupLabel}</td>
          <td>{row.main.display}</td>
          {optionBranchIds.map((branchId) => (
            <td key={branchId}>{row.options.get(branchId)?.display ?? '—'}</td>
          ))}
        </tr>
      ))}
    </>
  );
}
