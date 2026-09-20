import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, RelationshipType, UUID } from '../../contracts/delta';
import type { FactsRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { relationshipAttributeFieldSchema, RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE, validateRelationshipAttributeValue } from '../../contracts/relationshipAttributeSchema';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { attributesRecord } from './attributesRecord';
import type { DraftValue } from './useElementEditor';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type RelationshipEditorStatus = 'idle' | 'editing' | 'submitting';

export interface UseRelationshipEditorResult {
  status: RelationshipEditorStatus;
  values: Record<string, DraftValue>;
  fieldErrors: Record<string, string>;
  submitError: string | null;
  hasChanges: boolean;
  /** `false` only for `supports.role` on the relationship currently holding `primary` — promoting a different edge is the only way to change who holds it (see this file's own module comment); every other field is always editable once the caller's own role/branch gate (`canEdit`) already passed. */
  fieldEditable: (key: string) => boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  setValue: (key: string, value: DraftValue) => void;
  save: () => Promise<void>;
}

function initialDraftValue(fact: FactsRow | undefined): DraftValue {
  if (fact?.value === null || fact?.value === undefined) return '';
  if (typeof fact.value === 'boolean') return fact.value;
  if (typeof fact.value === 'number') return String(fact.value);
  if (typeof fact.value === 'string') return fact.value;
  return '';
}

function initialDraftValues(relationshipType: RelationshipType, facts: Map<string, FactsRow>): Record<string, DraftValue> {
  const values: Record<string, DraftValue> = {};
  for (const field of RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[relationshipType]) {
    if (field.editable === false) continue;
    values[field.key] = initialDraftValue(facts.get(field.key));
  }
  return values;
}

function draftEqualsFact(draft: DraftValue, fact: FactsRow | undefined): boolean {
  const current = fact?.value ?? null;
  if (typeof draft === 'boolean') return draft === current;
  const normalised = draft === '' ? null : draft;
  return normalised === current || (normalised !== null && typeof current === 'number' && String(current) === normalised);
}

export interface UseRelationshipEditorInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  relationship: RelationshipsHeadRow;
  /** This relationship's own facts (`RelationshipsSection`'s own `relationshipFacts.get(relationship.relationship_id)`), not the subject element's. */
  facts: Map<string, FactsRow>;
  /**
   * Every other live `supports` edge from this relationship's own
   * `from_element_id` (the system whose one landscape lane a `primary`
   * anchors) — `RelationshipsSection`'s own outbound `supports` group
   * already has exactly this list as its `rows`. Empty (and unused) for
   * every relationship type other than `supports`.
   */
  siblingSupportsRows: readonly RelationshipsHeadRow[];
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onSaved: () => void;
}

/**
 * Editing one relationship's own attributes, on the selected ref — the
 * relationship-row analogue of `useElementEditor.ts`, one commit per save,
 * one `relationship.update` delta per field that actually changed.
 *
 * `supports.role` promotion (C17, `src/engine/deltas.ts`'s
 * `checkPrimaryCardinality`): the engine already accepts a same-commit
 * "demote the current primary, then promote this one" pair as legal — this
 * hook is what actually builds that pair. Promoting this edge to `primary`
 * finds whichever sibling (`siblingSupportsRows`) currently holds it and
 * prepends a demote delta (`role: 'secondary'`) for it, ordered before the
 * promote delta in the same commit's `seq`, exactly the shape C17's own
 * check requires to treat the promotion as legal rather than a second live
 * primary.
 *
 * The reverse — demoting *this* edge away from `primary` through its own
 * edit — is refused outright, not attempted and left for the engine to
 * reject: `fieldEditable('role')` is `false` whenever this relationship is
 * the current primary, so the caller renders it read-only with an
 * explanation instead of an editable control that would only ever fail to
 * save. There is no supports edge left holding `primary` to demote to
 * once this is refused, so a promotion elsewhere is the only path, same as
 * the sprint's own "demoting the only primary is refused" wording.
 */
export function useRelationshipEditor(input: UseRelationshipEditorInput): UseRelationshipEditorResult {
  const { modelId, orgId, userId, relationship, facts, siblingSupportsRows, branch, expectedHeadCommitId, onSaved } = input;
  const [status, setStatus] = useState<RelationshipEditorStatus>('idle');
  const [values, setValues] = useState<Record<string, DraftValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const currentAttrs = attributesRecord(relationship.attributes);
  const isCurrentPrimary = relationship.relationship_type === 'supports' && currentAttrs.role === 'primary';

  const fieldEditable = useCallback(
    (key: string) => {
      if (relationship.relationship_type === 'supports' && key === 'role' && isCurrentPrimary) return false;
      return relationshipAttributeFieldSchema(relationship.relationship_type, key)?.editable !== false;
    },
    [relationship.relationship_type, isCurrentPrimary],
  );

  const startEditing = useCallback(() => {
    setValues(initialDraftValues(relationship.relationship_type, facts));
    setFieldErrors({});
    setSubmitError(null);
    setStatus('editing');
  }, [relationship.relationship_type, facts]);

  const cancelEditing = useCallback(() => {
    setStatus('idle');
    setFieldErrors({});
    setSubmitError(null);
  }, []);

  const setValue = useCallback((key: string, value: DraftValue) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasChanges = Object.entries(values).some(([key, value]) => !draftEqualsFact(value, facts.get(key)));

  const save = useCallback(async () => {
    if (!userId) {
      setSubmitError('You must be signed in to edit.');
      return;
    }
    setSubmitError(null);

    const changed = Object.entries(values).filter(([key, value]) => !draftEqualsFact(value, facts.get(key)));
    if (changed.length === 0) {
      setStatus('idle');
      return;
    }

    const errors: Record<string, string> = {};
    const validated: { key: string; value: Json }[] = [];
    for (const [key, draft] of changed) {
      // Refused outright (see this hook's own module comment) rather than
      // sent to the engine to reject — `fieldEditable` already hides the
      // control for this exact case, but `values` can still hold a stale
      // draft from before the row's own current-primary state changed
      // underneath it (another tab's promotion, e.g.).
      if (!fieldEditable(key)) {
        errors[key] = "Promote a different supports edge to primary first — the current primary can't be demoted directly.";
        continue;
      }
      const result = validateRelationshipAttributeValue(relationship.relationship_type, key, draft);
      if (!result.ok) errors[key] = result.error;
      else validated.push({ key, value: result.value });
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setStatus('submitting');

    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

      // Built from runtime data the same way useElementEditor.ts's own
      // identical cast is — validateRelationshipAttributeValue already
      // checked `key`/`value` agree with relationship_type's own schema.
      const updateDeltas: Delta[] = validated.map(
        ({ key, value }) =>
          ({
            kind: 'relationship.update',
            id: crypto.randomUUID(),
            relationshipId: relationship.relationship_id,
            relationshipType: relationship.relationship_type,
            attribute: key,
            value,
            previousDeltaId: facts.get(key)?.delta_id ?? relationship.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          }) as Delta,
      );

      // C17's own same-commit demote-then-promote shape: a promotion to
      // `primary` prepends a demote delta for whichever sibling currently
      // holds it, ordered first so the head this commit folds to never
      // holds two live primaries at once, even mid-commit.
      const promoting = validated.find((v) => relationship.relationship_type === 'supports' && v.key === 'role' && v.value === 'primary');
      const deltas: Delta[] = [...updateDeltas];
      if (promoting) {
        const currentPrimary = siblingSupportsRows.find((r) => r.relationship_id !== relationship.relationship_id && attributesRecord(r.attributes).role === 'primary');
        if (currentPrimary) {
          // `previousDeltaId` isn't validated against the head at
          // commit-apply time (`src/engine/deltas.ts`'s own `relationship.update`
          // case only checks the relationship exists) — it's chain
          // metadata for merge/undo, not a write-time guard — so falling
          // back to the sibling's own `exists_delta_id` here (this
          // component doesn't have its facts loaded, only its head row) is
          // the same safe default `useElementEditor.ts` already uses for
          // an attribute with no prior fact of its own.
          deltas.unshift({
            kind: 'relationship.update',
            id: crypto.randomUUID(),
            relationshipId: currentPrimary.relationship_id,
            relationshipType: 'supports',
            attribute: 'role',
            value: 'secondary',
            previousDeltaId: currentPrimary.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          });
        }
      }

      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: describeEnvelope(deltas, () => undefined),
        body: `Edit the ${relationship.relationship_type} relationship`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('editing');
        setSubmitError(
          result.reason === 'conflict'
            ? 'This relationship changed since you loaded it. Reload the page and try again.'
            : `Could not save: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
      // E8 item (1): invalidates the shared main/editing-branch cache — see invalidateModelHead.ts's own comment.
      void invalidateModelHead(queryClient, modelId);
      onSaved();
    } catch (e) {
      setStatus('editing');
      setSubmitError(e instanceof Error ? e.message : 'Could not save.');
    }
  }, [values, facts, relationship, siblingSupportsRows, fieldEditable, modelId, orgId, userId, branch, expectedHeadCommitId, onSaved, queryClient]);

  return { status, values, fieldErrors, submitError, hasChanges, fieldEditable, startEditing, cancelEditing, setValue, save };
}
