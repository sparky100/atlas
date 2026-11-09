import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { updateBranchMetadata } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import styles from './DecisionView.module.css';

export interface DecisionGoLiveProps {
  /** The chosen option's change. Only shown while it is still a draft: the target date is editable then, and a merged change is already live. */
  branch: BranchRow;
  canEdit: boolean;
  /** Re-reads the decision's options so the saved date shows without a page reload. */
  onSaved: () => Promise<void>;
  /** Opens the chosen change, where the system's own dates and the rest of the design are edited. */
  onWorkOnChange: (branchId: UUID) => void;
}

/**
 * The step after Choose: "When does this go live?". The date is the chosen
 * change's own target date (`branches.target_date`, the same column the
 * Changes page and the roadmap read), so saving it here puts the planned
 * add or retire on the roadmap at that date. Nothing new is stored.
 */
export function DecisionGoLive({ branch, canEdit, onSaved, onWorkOnChange }: DecisionGoLiveProps) {
  const [date, setDate] = useState(branch.target_date ?? '');
  const [saving, setSaving] = useState(false);
  if (branch.status !== 'draft') return null;

  const unchanged = date === (branch.target_date ?? '');

  async function save() {
    setSaving(true);
    try {
      await updateBranchMetadata(supabase, branch.id, { targetDate: date.trim().length > 0 ? date.trim() : null });
      await onSaved();
    } catch (e) {
      reportError('Could not save the go-live date.', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel>
      <Text as="h2" size="lg">
        When does this go live?
      </Text>
      <Text as="p" tone="muted" size="sm">
        {branch.target_date === null ? 'No date set yet, so this does not appear on the Roadmap.' : `Planned for ${branch.target_date}. It appears on the Roadmap at that date.`}
      </Text>
      {canEdit && (
        <div className={styles.addOptionForm}>
          <input
            className={styles.input}
            type="date"
            aria-label="Go-live date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
          <Button variant="primary" disabled={saving || unchanged} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save date'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onWorkOnChange(branch.id);
            }}
          >
            Build this in the model
          </Button>
        </div>
      )}
    </Panel>
  );
}
