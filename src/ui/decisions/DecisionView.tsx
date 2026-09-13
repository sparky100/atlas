import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { CommentsSection } from '../components/CommentsSection/CommentsSection';
import { ElementTypeGlyph } from '../components/ElementTypeGlyph/ElementTypeGlyph';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useAuth } from '../auth/useAuth';
import type { MemberRole } from '../../db/types';
import { intentHeaderLine } from '../changes/branchIntent';
import { branchStatusTone } from '../changes/branchStatus';
import { decisionStatusTone } from './decisionStatus';
import { useDecision } from './useDecision';
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
 * A single decision's own page (prompt pack F3 PR4) — context, owner,
 * needed-by, its links, its (always-empty-for-now) arguments, and
 * comments. Mirrors `ChangeView.tsx`'s general shape, minus everything
 * that's a later PR: no options/comparison table (PR5), no "Choose"
 * action (PR5), no "why is this here" reverse lookup (PR6) — this is
 * F3's own "plain create/list/detail" slice.
 */
export function DecisionView({ modelId, decisionId, orgId, orgSlug, modelSlug, role }: DecisionViewProps) {
  const { userId } = useAuth();
  const { state } = useDecision(modelId, decisionId);

  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'not_found') return <Text as="p">No decision found for this id.</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const { decision, links, linkedElementsById, linkedBranchesById, args } = state;
  const elementLinks = links.filter((l) => l.linked_type === 'element' || l.linked_type === 'relationship');
  const branchLinks = links.filter((l) => l.linked_type === 'branch');

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
              return (
                <li key={link.linked_id} className={styles.linkRow}>
                  {branch ? (
                    <>
                      <Chip tone={branchStatusTone(branch.status)}>{branch.status}</Chip>
                      <Link to={`/o/${orgSlug}/m/${modelSlug}/changes/${branch.id}`}>
                        <Text as="span">{intentHeaderLine(branch)}</Text>
                      </Link>
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
