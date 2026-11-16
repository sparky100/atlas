import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { BranchIntent, BranchRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useChanges } from '../changes/useChanges';
import styles from './HomeSearch.module.css';

export interface ProposeChangePickerProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  onChosen: (branch: BranchRow) => void;
  onCancel: () => void;
  /**
   * Sprint 7i item 4's "Propose a change" entry point on an element page:
   * "creates a change scoped to that element" — seeded into the new
   * change's `description` (there is no element-scoping column on
   * `branches` itself; the element association is product-level text, not
   * schema). Omitted (the default, `''`) for `HomeSearch.tsx`'s own use of
   * this picker, which isn't about any one already-existing element.
   */
  defaultDescription?: string;
  /** Prompt pack F0: required for every new change this picker creates — `branchIntent.ts`'s `defaultIntentForEntryPoint` names each call site's own default; a caller that lets the person choose (e.g. a toggle between `correct`/`propose` on the element page) just passes whichever value that choice currently holds. */
  defaultIntent: BranchIntent;
}

/**
 * Handoff — Flow: Add a system, decision 5: a contributor viewing main has
 * no direct create-on-main path (`roleGates.ts`'s `canEditOnMain`) — this
 * is the "propose a change" picker `roleGates.ts`'s own comment on
 * `canEditOnMain` named as still-unbuilt ("a contributor's real path to
 * editing is creating or opening a change branch first"). Pick one of the
 * contributor's own open drafts, or start a new one inline — `useChanges`
 * does the real work either way (same hook `ChangesView.tsx` uses); this is
 * a narrower, inline-first surface for it, not a second implementation.
 */
export function ProposeChangePicker({ modelId, orgId, userId, onChosen, onCancel, defaultDescription = '', defaultIntent }: ProposeChangePickerProps) {
  const { status, branches, error, createChange } = useChanges(modelId, orgId, userId);
  const [selectedId, setSelectedId] = useState('');
  const [newName, setNewName] = useState('');
  const myDrafts = branches.filter((b) => b.created_by === userId && b.status === 'draft');

  return (
    <div className={styles.proposePanel}>
      <Text as="p" size="sm">
        You can propose this as part of a change, not add it to the live model directly.
      </Text>
      {status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading your changes…
        </Text>
      )}
      {myDrafts.length > 0 && (
        <div className={styles.proposeRow}>
          <select
            className={styles.select}
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
            }}
          >
            <option value="">Choose one of your changes…</option>
            {myDrafts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title ?? b.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={selectedId === ''}
            onClick={() => {
              const chosen = myDrafts.find((b) => b.id === selectedId);
              if (chosen) onChosen(chosen);
            }}
          >
            Use this change
          </Button>
        </div>
      )}
      <Text as="p" tone="muted" size="sm">
        or start a new change:
      </Text>
      <div className={styles.proposeRow}>
        <input
          type="text"
          className={styles.input}
          aria-label="What's this change?"
          placeholder="What's this change? (e.g. Retire Northgate)"
          value={newName}
          onChange={(e) => {
            setNewName(e.target.value);
          }}
        />
        <Button
          variant="primary"
          disabled={status === 'creating' || newName.trim().length === 0}
          onClick={() => {
            void createChange({ title: newName, description: defaultDescription, targetDate: '', intent: defaultIntent }).then((branch) => {
              if (branch) onChosen(branch);
            });
          }}
        >
          {status === 'creating' ? 'Creating…' : 'Create & continue'}
        </Button>
      </div>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      {error !== null && (
        <Text as="p" size="sm">
          {error}
        </Text>
      )}
    </div>
  );
}
