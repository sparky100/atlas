import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { AttributeFieldSchema } from '../../contracts/attributeSchema';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, Json } from '../../contracts/rows';
import type { BranchRow } from '../../db/types';
import { bulkEditCellKey, draftEqualsFactValue, initialBulkEditDraft, type BulkEditDraft } from '../../engine/bulkEdit';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';
import { attributesRecord } from './attributesRecord';
import { commitBulkEdit } from './bulkEdit';

interface CellDraft {
  elementId: UUID;
  key: string;
  draft: BulkEditDraft;
  /** The element's own value when this cell was first touched — what "changed" is measured against. */
  initial: Json | undefined;
}

export interface UseBulkEditInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The branch the grid writes to — main, or the selected draft change; `null` until it has loaded. */
  branch: BranchRow | null;
  customFields: ReadonlyMap<string, { field: AttributeFieldSchema; appliesTo: readonly string[] }>;
  onSaved: () => void;
}

export interface BulkEditController {
  editing: boolean;
  submitting: boolean;
  /** Cells whose draft differs from the value they started at. */
  changedCount: number;
  /** Per-cell validation errors from the last save attempt, keyed by `bulkEditCellKey`. */
  errors: ReadonlyMap<string, string>;
  submitError: string | null;
  start: () => void;
  cancel: () => void;
  draftFor: (element: ElementsHeadRow, key: string) => BulkEditDraft;
  setDraft: (element: ElementsHeadRow, key: string, draft: BulkEditDraft) => void;
  save: (elements: readonly ElementsHeadRow[]) => Promise<void>;
}

/**
 * F12 step 1: the Elements grid's edit mode. Holds a draft per touched
 * cell; Save writes every changed cell as one commit (`commitBulkEdit`).
 * A cell's starting value is the element's own attribute, never an
 * inherited one (a module's effective lifecycle, say) — editing writes the
 * element's own fact, so that's what the editor must show.
 */
export function useBulkEdit(input: UseBulkEditInput): BulkEditController {
  const { modelId, orgId, userId, branch, customFields, onSaved } = input;
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<ReadonlyMap<string, CellDraft>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    setDrafts(new Map());
    setErrors(new Map());
    setSubmitError(null);
  }, []);

  const start = useCallback(() => {
    reset();
    setEditing(true);
  }, [reset]);

  const cancel = useCallback(() => {
    reset();
    setEditing(false);
  }, [reset]);

  const draftFor = useCallback(
    (element: ElementsHeadRow, key: string) => drafts.get(bulkEditCellKey(element.element_id, key))?.draft ?? initialBulkEditDraft(attributesRecord(element.attributes)[key]),
    [drafts],
  );

  const setDraft = useCallback((element: ElementsHeadRow, key: string, draft: BulkEditDraft) => {
    const cellKey = bulkEditCellKey(element.element_id, key);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(cellKey, { elementId: element.element_id, key, draft, initial: prev.get(cellKey)?.initial ?? attributesRecord(element.attributes)[key] });
      return next;
    });
    setErrors((prev) => {
      if (!prev.has(cellKey)) return prev;
      const next = new Map(prev);
      next.delete(cellKey);
      return next;
    });
  }, []);

  const changed = [...drafts.values()].filter((cell) => !draftEqualsFactValue(cell.draft, cell.initial));

  const save = useCallback(
    async (elements: readonly ElementsHeadRow[]) => {
      if (!userId || !branch) {
        setSubmitError(!userId ? 'You must be signed in to edit.' : 'Still loading — try again in a moment.');
        return;
      }
      const cells = [...drafts.values()].filter((cell) => !draftEqualsFactValue(cell.draft, cell.initial)).map(({ elementId, key, draft }) => ({ elementId, key, draft }));
      if (cells.length === 0) {
        cancel();
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = await commitBulkEdit(supabase, {
          modelId,
          orgId,
          userId,
          branch,
          expectedHeadCommitId: branch.head_commit_id,
          cells,
          elementsById: new Map(elements.map((element) => [element.element_id, element])),
          customFields,
        });
        if (!result.ok) {
          if (result.reason === 'validation') setErrors(result.errors);
          else setSubmitError(result.reason === 'conflict' ? 'The model changed since you loaded this page. Reload and try again — your edits here are kept until you do.' : `Could not save: ${result.message}`);
          return;
        }
        if (result.commitId !== null) {
          applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
          reportToast(branch.kind === 'change' ? `Saved ${String(cells.length)} ${cells.length === 1 ? 'change' : 'changes'} to change: ${branch.title ?? branch.name}` : `Saved ${String(cells.length)} ${cells.length === 1 ? 'change' : 'changes'}`);
        }
        reset();
        setEditing(false);
        onSaved();
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Could not save.');
      } finally {
        setSubmitting(false);
      }
    },
    [drafts, userId, modelId, orgId, branch, customFields, queryClient, reset, cancel, onSaved],
  );

  return { editing, submitting, changedCount: changed.length, errors, submitError, start, cancel, draftFor, setDraft, save };
}
