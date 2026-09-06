import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import type { CapabilityMapTree } from './layout';
import { useCapabilityCreate } from './useCapabilityCreate';
import styles from './CapabilityMapAddForm.module.css';

export interface CapabilityMapAddFormProps {
  tree: CapabilityMapTree;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** Which branch this create commits to — see src/ui/elements/useElementEditor.ts's `branch` doc comment (Sprint C1). */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

/**
 * The tailoring flow's "add" action (Sprint U2 step 2). The parent picker
 * only ever offers L1/L2 capabilities (or "Top level") — never an L3 tile,
 * which would create a 4th level the map's own layout (src/ui/
 * capabilityMap/layout.ts: "L1 columns, L2 cards, L3 on zoom") has no slot
 * to render; such a capability would just fall into `tree.orphans` next
 * load, which is a worse experience than the picker simply not offering it.
 */
export function CapabilityMapAddForm({ tree, modelId, orgId, userId, branch, expectedHeadCommitId, onCreated }: CapabilityMapAddFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const { status, error, create } = useCapabilityCreate({
    modelId,
    orgId,
    userId,
    branch,
    expectedHeadCommitId,
    onCreated: () => {
      setOpen(false);
      setName('');
      setParentId('');
      onCreated();
    },
  });

  const parentOptions = [...tree.l1, ...tree.l1.flatMap((l1) => l1.l2)];

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => { setOpen(true); }}>
        + Add capability
      </Button>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void create(name, parentId === '' ? null : parentId);
      }}
    >
      <input className={styles.input} type="text" placeholder="Capability name" value={name} onChange={(e) => { setName(e.target.value); }} />
      <select className={styles.select} value={parentId} onChange={(e) => { setParentId(e.target.value); }}>
        <option value="">Top level</option>
        {parentOptions.map((option) => (
          <option key={option.capability.element_id} value={option.capability.element_id}>
            {option.capability.name}
          </option>
        ))}
      </select>
      <Button variant="primary" type="submit" disabled={status === 'creating'}>
        {status === 'creating' ? 'Adding…' : 'Add'}
      </Button>
      <Button
        variant="ghost"
        type="button"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </Button>
      {error !== null && (
        <Text as="p" tone="default">
          {error}
        </Text>
      )}
    </form>
  );
}
