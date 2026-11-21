import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { AffectedCapability } from '../../db/changeSummary';
import type { BranchRow } from '../../db/types';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useMainBranch } from '../branches/useMainBranch';
import { ProjectBeforeAfter } from '../projects/ProjectBeforeAfter';
import styles from './ChangeImpactPreview.module.css';

/** The same derived before/after picture used on the project, shown while a draft is still editable. */
export function ChangeImpactPreview({ modelId, branch, affectedCapabilities, base }: {
  modelId: UUID;
  branch: BranchRow;
  affectedCapabilities: readonly AffectedCapability[];
  base: string;
}) {
  const [open, setOpen] = useState(false);
  const { branch: main, loading } = useMainBranch(modelId);
  const capabilities = affectedCapabilities.filter(({ viaSystems }) => viaSystems.length > 0).map(({ capability }) => ({ id: capability.element_id, name: capability.name }));
  const scopeSystemIds = new Set(affectedCapabilities.flatMap(({ viaSystems }) => viaSystems.map((s) => s.element_id)));

  return (
    <Panel data-testid="change-impact-preview">
      <details open={open} onToggle={(event) => { setOpen(event.currentTarget.open); }}>
        <summary className={styles.summary}>Preview impact <Text as="span" size="sm" tone="muted">— today and this draft</Text></summary>
        <div className={styles.body}>
          {loading ? <Text as="p" tone="muted">Loading the live model…</Text> :
            main?.head_commit_id == null ? <Text as="p">The live model could not be loaded for comparison.</Text> :
            capabilities.length === 0 ? (
              <Text as="p">These edits do not change a system supporting a capability. Review the changed elements and affected value streams below; there is no system diagram to draw.</Text>
            ) : (
              <>
                {main.head_commit_id !== branch.base_commit_id && <Text as="p" size="sm" tone="muted">The live model has moved since this draft began. Review this comparison and bring the draft up to date before approval.</Text>}
                <ProjectBeforeAfter
                  embedded
                  modelId={modelId}
                  comparisonId={branch.id}
                  mainHeadCommitId={main.head_commit_id}
                  changes={[branch]}
                  capabilities={capabilities}
                  scopeSystemIds={scopeSystemIds}
                  decisions={[]}
                  base={base}
                  intro="The left side is the live model; the right side is this draft. Affected capabilities with supporting systems are shown. Other systems sharing a capability are available separately for context."
                  scopeLabel="draft"
                />
              </>
            )}
        </div>
      </details>
    </Panel>
  );
}
