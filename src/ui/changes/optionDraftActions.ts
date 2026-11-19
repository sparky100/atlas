import type { UUID } from '../../contracts/delta';

/**
 * Deterministic starting edits for an option change that has none yet (no AI).
 * A system the decision names directly is the one being replaced: "Retire X and
 * replace it with a new system". A system the model records as supporting a
 * capability the decision concerns is the one that could be extended: "Extend X
 * to cover C". Pure, so it is easy to test and never writes anything: each
 * action only opens the existing Retire panel or edit form on this change.
 */
export interface OptionDraftAction {
  kind: 'retire-and-replace' | 'extend';
  systemId: UUID;
  systemName: string;
  /** The capability an "extend" action covers; `null` for retire-and-replace. */
  capabilityName: string | null;
}

export interface DraftSystem {
  id: UUID;
  name: string;
}

const MAX_PER_KIND = 3;

export function optionDraftActions(concernedSystems: readonly DraftSystem[], supporters: readonly DraftSystem[], capabilityNames: readonly string[]): OptionDraftAction[] {
  const retire = concernedSystems.slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, capabilityName: null }));
  const named = new Set(concernedSystems.map((s) => s.id));
  const capability = capabilityNames[0] ?? null;
  const extend = capability === null ? [] : supporters.filter((s) => !named.has(s.id)).slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'extend', systemId: s.id, systemName: s.name, capabilityName: capability }));
  return [...retire, ...extend];
}

export function optionDraftLabel(action: OptionDraftAction): string {
  return action.kind === 'retire-and-replace' ? `Retire ${action.systemName} and replace it with a new system` : `Extend ${action.systemName} to cover ${action.capabilityName ?? 'this'}`;
}
