import { useId, useState } from 'react';
import type { InterfaceType, UUID } from '../../../contracts/delta';
import { INTERFACE_TYPE_LEVELS } from '../../../contracts/attributeSchema';
import type { BranchRow } from '../../../db/types';
import { useElementCreate } from '../../elements/useElementCreate';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './AddInterfaceForm.module.css';

export interface AddInterfaceFormProps {
  /** The integration platform this interface belongs to (its parent). */
  platformId: UUID;
  platformName: string;
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onCreated: () => void;
}

/**
 * ADR-026: "+ Add interface" on an integration platform's own page — the
 * interface's name, type and (optionally) what the platform does to the data,
 * in one form and one commit (`useElementCreate` with the attributes on the
 * create delta itself). Stays on the platform's page afterwards, where the
 * new interface appears in the list above, so several can be added in a row.
 */
export function AddInterfaceForm({ platformId, platformName, modelId, orgId, userId, branch, expectedHeadCommitId, onCreated }: AddInterfaceFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [interfaceType, setInterfaceType] = useState<InterfaceType | ''>('');
  const [transformation, setTransformation] = useState('');
  const nameId = useId();
  const typeId = useId();
  const transformationId = useId();

  const reset = () => {
    setName('');
    setInterfaceType('');
    setTransformation('');
  };

  const { status, error, create } = useElementCreate({
    modelId,
    orgId,
    userId,
    elementType: 'container',
    parentId: platformId,
    branch,
    expectedHeadCommitId,
    onCreated: () => {
      reset();
      setOpen(false);
      onCreated();
    },
  });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => { setOpen(true); }}>
        + Add interface
      </Button>
    );
  }

  const canSubmit = name.trim().length > 0 && interfaceType !== '' && status !== 'creating';

  return (
    <form
      className={styles.form}
      aria-label={`Add an interface to ${platformName}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        const trimmedTransformation = transformation.trim();
        void create(name, { attributes: { interfaceType, ...(trimmedTransformation !== '' ? { transformation: trimmedTransformation } : {}) } });
      }}
    >
      <label htmlFor={nameId} className={styles.label}>
        <Text as="span" size="sm">
          Interface name
        </Text>
      </label>
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opening the form is the request to type its name next.
        autoFocus
        id={nameId}
        className={styles.input}
        placeholder="e.g. Customer API, Meter reads file"
        value={name}
        onChange={(e) => { setName(e.target.value); }}
      />
      <label htmlFor={typeId} className={styles.label}>
        <Text as="span" size="sm">
          Interface type
        </Text>
      </label>
      <select id={typeId} className={styles.input} value={interfaceType} onChange={(e) => { setInterfaceType(e.target.value as InterfaceType | ''); }}>
        <option value="">Choose…</option>
        {INTERFACE_TYPE_LEVELS.map((level) => (
          <option key={level.key} value={level.key}>
            {level.label}
          </option>
        ))}
      </select>
      <label htmlFor={transformationId} className={styles.label}>
        <Text as="span" size="sm">
          Transformation <span className={styles.optional}>(optional)</span>
        </Text>
      </label>
      <textarea
        id={transformationId}
        className={styles.textarea}
        placeholder="What the platform does to the data — maps, enriches, combines, turns a file into an API…"
        value={transformation}
        onChange={(e) => { setTransformation(e.target.value); }}
      />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {status === 'creating' ? 'Adding…' : 'Add interface'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={status === 'creating'}
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </form>
  );
}
