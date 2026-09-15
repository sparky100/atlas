import { useEffect, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { listMembers } from '../../db/organisations';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { attributesRecord } from '../elements/attributesRecord';
import { profileLabel } from '../comments/profileLabel';
import { reportError } from '../errors/errorBannerStore';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';

export interface ActorMemberPickerProps {
  modelId: UUID;
  orgId: UUID;
  userId: UUID;
  /** The actor whose `memberId` this edits. */
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onSaved: () => void;
}

/**
 * F3a's actor↔member link: sets (or clears) which member an actor
 * represents, so the review's derived reviewer set can resolve an owner
 * *actor* to a real *member*. `memberId` is hidden from the generic
 * Attributes editor (`attributeSchema.ts`'s `hidden`/`editable: false`) —
 * it's a uuid reference into `auth.users`, not a free-text/selected fact —
 * so this writes its own `element.update` delta rather than routing through
 * `useElementEditor`.
 */
export function ActorMemberPicker({ modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onSaved }: ActorMemberPickerProps) {
  const currentMemberId = (() => {
    const value = attributesRecord(element.attributes).memberId;
    return typeof value === 'string' && value.length > 0 ? value : null;
  })();
  const [members, setMembers] = useState<{ userId: UUID; label: string }[]>([]);
  const [selected, setSelected] = useState<string>(currentMemberId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMembers(supabase, orgId)
      .then((rows) => {
        if (cancelled) return;
        setMembers(rows.map((m) => ({ userId: m.member.user_id, label: m.profile ? profileLabel(m.profile) : m.member.user_id })));
      })
      .catch((e: unknown) => {
        reportError("Couldn't load members.", e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load members.');
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const dirty = selected !== (currentMemberId ?? '');

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
      const delta: Delta = {
        kind: 'element.update',
        id: crypto.randomUUID(),
        elementId: element.element_id,
        elementType: 'actor',
        attribute: 'memberId',
        value: selected === '' ? null : selected,
        previousDeltaId: facts.get('memberId')?.delta_id ?? element.exists_delta_id,
        sourceId: source.id,
        confidence: 1,
      };
      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: selected === '' ? `Unlink ${element.name} from a member` : `Link ${element.name} to a member`,
        body: `Edit ${element.name}`,
        deltas: [delta],
      };
      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setError(result.reason === 'conflict' ? 'This element changed since you loaded it. Reload the page and try again.' : `Could not save: ${result.message}`);
        return;
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Text as="span" size="sm">
        Member
      </Text>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
          }}
        >
          <option value="">No member</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error !== null && <Text as="p">{error}</Text>}
    </div>
  );
}
