import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow, Json } from '../../contracts/rows';
import { ATTRIBUTE_SCHEMA_BY_TYPE, validateAttributeValue } from '../../contracts/attributeSchema';
import { commitToBranch } from '../../db/commits';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

/** A field's draft value in the edit form — always a plain string except for `boolean` fields, which a checkbox produces directly. */
export type DraftValue = string | boolean;

export type ElementEditorStatus = 'idle' | 'editing' | 'submitting';

export interface UseElementEditorResult {
  status: ElementEditorStatus;
  values: Record<string, DraftValue>;
  fieldErrors: Record<string, string>;
  submitError: string | null;
  hasChanges: boolean;
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

function initialDraftValues(element: ElementsHeadRow, facts: Map<string, FactsRow>): Record<string, DraftValue> {
  const values: Record<string, DraftValue> = {};
  for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[element.element_type]) {
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

export interface UseElementEditorInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /**
   * Which branch this edit commits to — `main` (owner/architect,
   * UI-principles §4.2) or a draft change branch (contributor+, ADR-009,
   * Sprint C1). `facts` must already reflect this branch's own current
   * head (src/db/branchFacts.ts's `loadFactsForSubjectAtBranch` for
   * anything other than main, since a change branch's head is never
   * materialised — SPEC §1 S-2), not main's, or `previousDeltaId` below
   * would supersede the wrong fact.
   */
  branch: BranchRow;
  /** The commit the page currently believes `branch`'s head is — becomes `expectedHeadCommitId` (C13's optimistic-concurrency check). */
  expectedHeadCommitId: UUID;
  onSaved: () => void;
}

/**
 * Editing at `main` or on a draft change branch (UI-principles §4.2,
 * ADR-015, ADR-009 — Sprint C1 generalises this beyond main-only). One
 * commit per save, one `element.update` delta per field that actually
 * changed — an untouched field never becomes a delta just because the
 * form rendered it. Every delta shares one commit's provenance: the
 * caller's own manual source (`getOrCreateManualSource`), confidence 1.0
 * ("Human-asserted facts are 1.00", src/contracts/delta.ts), no
 * `effectiveDate` (§4.3: absent means "age" reads from the commit time,
 * which is exactly when this was learned).
 */
export function useElementEditor(input: UseElementEditorInput): UseElementEditorResult {
  const { modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onSaved } = input;
  const [status, setStatus] = useState<ElementEditorStatus>('idle');
  const [values, setValues] = useState<Record<string, DraftValue>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const startEditing = useCallback(() => {
    setValues(initialDraftValues(element, facts));
    setFieldErrors({});
    setSubmitError(null);
    setStatus('editing');
  }, [element, facts]);

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
      const result = validateAttributeValue(element.element_type, key, draft);
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

      // Built from runtime data (`key` is a string, not one of
      // ElementUpdate<T>'s per-type attribute literals) — `validateAttributeValue`
      // already checked `key`/`value` agree with element.element_type's own
      // schema, which is the real guarantee `Delta`'s type parameters exist
      // to express statically; this cast is that check's dynamic analogue,
      // the same boundary contracts/rows.ts's `fromDeltaRow` casts at.
      const deltas: Delta[] = validated.map(
        ({ key, value }) =>
          ({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: element.element_type,
            attribute: key,
            value,
            previousDeltaId: facts.get(key)?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          }) as Delta,
      );

      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        message: `Edit ${element.name}`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('editing');
        setSubmitError(
          result.reason === 'conflict'
            ? 'This element changed since you loaded it. Reload the page and try again.'
            : `Could not save: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      onSaved();
    } catch (e) {
      setStatus('editing');
      setSubmitError(e instanceof Error ? e.message : 'Could not save.');
    }
  }, [values, facts, element, modelId, orgId, userId, branch, expectedHeadCommitId, onSaved]);

  return { status, values, fieldErrors, submitError, hasChanges, startEditing, cancelEditing, setValue, save };
}
