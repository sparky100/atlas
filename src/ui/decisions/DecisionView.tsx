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
import { branchStatusTone } from '../changes/branchStatus';
import { canChooseDecisionOption, canCreateChangeBranch } from '../orgs/useMembership';
import { decisionStatusTone } from './decisionStatus';
import { useDecision } from './useDecision';
import { useDecisionComparison, type DecisionComparisonOption } from './useDecisionComparison';
import { useDecisionOptions } from './useDecisionOptions';
import styles from './DecisionView.module.css';

export interface DecisionViewProps {
  modelId: UUID;
  decisionId: UUID;
  orgId: UUID;
  orgSlug: string;
  modelSlug: string;
  role: MemberRole | null;
}

/**
 * A single decision's own page (prompt pack F3). PR4 built context/owner/
 * needed-by, its links, and comments; PR5 adds "Add an option" (a fresh
 * `explore`-intent branch, linked), the comparison table
 * (`compareOptions.ts` — each option's own folded state re-run through
 * the existing capability-map metrics and boundary-crossing finding,
 * diffed against main), and "Choose" (`atlas.choose_decision_option` in
 * one call). "Start a decision" from a health finding and "why is this
 * here" are PR6.
 */
export function DecisionView({ modelId, decisionId, orgId, orgSlug, modelSlug, role }: DecisionViewProps) {
  const { userId } = useAuth();
  const { state, reload } = useDecision(modelId, decisionId);
  const { branch: main } = useMainBranch(modelId);
  const optionsState = useDecisionOptions(reload);

  const [addingOption, setAddingOption] = useState(false);
  const [optionName, setOptionName] = useState('');
  const [optionTitle, setOptionTitle] = useState('');
  const [choosingBranchId, setChoosingBranchId] = useState<UUID | null>(null);
  const [reasons, setReasons] = useState('');

  // Every hook above must run unconditionally (rules of hooks) — the
  // comparison hook too, even before `state` has resolved to `ready`;
  // it degrades to its own `'empty'` state on an empty/not-yet-loaded input.
  const readyState = state.status === 'ready' ? state : null;
  const elementLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship') : [];
  const branchLinks = readyState ? readyState.links.filter((l) => l.linked_type === 'branch') : [];
  const concernedCapabilityIds = readyState ? elementLinks.map((l) => l.linked_id).filter((id) => readyState.linkedElementsById.get(id)?.element_type === 'capability') : [];
  const comparisonOptions: DecisionComparisonOption[] = readyState
    ? branchLinks
        .map((l) => readyState.linkedBranchesById.get(l.linked_id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined)
        .map((b) => ({ branchId: b.id, headCommitId: b.head_commit_id, label: intentHeaderLine(b) }))
    : [];
  const comparison = useDecisionComparison(modelId, main?.head_commit_id ?? null, concernedCapabilityIds, comparisonOptions);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'not_found') return <Text as="p">No decision found for this id.</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const { decision, linkedElementsById, linkedBranchesById, args } = state;
  const canAddOption = canCreateChangeBranch(role) && decision.status === 'proposed';
  const canChoose = canChooseDecisionOption(role) && decision.status === 'proposed';

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
          Options
        </Text>
        {branchLinks.length === 0 ? (
          <EmptyState>No options added yet.</EmptyState>
        ) : (
          <ul className={styles.linkList}>
            {branchLinks.map((link) => {
              const branch = linkedBranchesById.get(link.linked_id);
              const isChosen = decision.branch_id === link.linked_id;
              return (
                <li key={link.linked_id} className={styles.linkRow}>
                  {branch ? (
                    <>
                      {isChosen && <Chip tone="ok">chosen</Chip>}
                      <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
                        <Text as="span">{intentHeaderLine(branch)}</Text>
                      </Link>
                      {canChoose && branch.status === 'draft' && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setChoosingBranchId(link.linked_id);
                            setReasons('');
                          }}
                        >
                          Choose
                        </Button>
                      )}
                    </>
                  ) : (
                    <Text as="span" tone="muted" size="sm">
                      A linked change that no longer resolves.
                    </Text>
                  )}
                </li>
              );
            })}
          </ul>
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

        {comparison.status === 'ready' && concernedCapabilityIds.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>{comparison.main.label}</th>
                  {comparison.options.map((o) => (
                    <th key={o.branchId}>{o.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {concernedCapabilityIds.map((capabilityId) => (
                  <tr key={capabilityId}>
                    <td>{linkedElementsById.get(capabilityId)?.name ?? capabilityId}</td>
                    <td>{formatCapabilityMetrics(comparison.main.metricsByCapabilityId.get(capabilityId))}</td>
                    {comparison.options.map((o) => (
                      <td key={o.branchId}>{formatCapabilityMetrics(o.metricsByCapabilityId.get(capabilityId))}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td>Boundary crossings (model-wide)</td>
                  <td>{comparison.main.boundaryCrossingCount}</td>
                  {comparison.options.map((o) => (
                    <td key={o.branchId}>{o.boundaryCrossingCount}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {comparison.status === 'loading' && (
          <Text as="p" tone="muted" size="sm">
            Comparing…
          </Text>
        )}
        {comparison.status === 'error' && <Text as="p">{comparison.message}</Text>}

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

function formatCapabilityMetrics(metrics: { coverage: number; oldestLifecycleStage: string | null; criticality: string | null } | undefined): string {
  if (!metrics) return '—';
  const parts = [`${String(metrics.coverage)} system${metrics.coverage === 1 ? '' : 's'}`];
  if (metrics.oldestLifecycleStage) parts.push(metrics.oldestLifecycleStage);
  if (metrics.criticality) parts.push(metrics.criticality);
  return parts.join(' · ');
}
