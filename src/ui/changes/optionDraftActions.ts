import type { UUID } from '../../contracts/delta';
import type { OptionApproach } from '../../contracts/optionApproach';

/**
 * Deterministic starting edits for an option change that has none yet (no AI).
 * What is offered follows the option's stored approach
 * (`decision_options.approach`), because buying a product and building
 * ourselves are different first edits:
 *   - keep      : nothing. "Keep and tidy up" starts from the existing system, so there is no obvious first edit.
 *   - configure : "Extend X to cover C" for a system that supports (or is named by) the decision.
 *   - buy       : "Retire X and replace it with a new system" for the system the decision names or the capability's supporter.
 *   - build     : "Retire X and replace it with a custom-built app" for the same systems; "Create a new system for C" only when no existing system is known.
 * An option whose approach is not decided yet gets nothing rather than a wrong suggestion.
 * Pure, so it is easy to test and never writes anything: each action only opens
 * the existing Retire panel, edit form or add-a-system box on this change.
 */
export type OptionKind = OptionApproach;

export interface OptionDraftAction {
  kind: 'retire-and-replace' | 'extend' | 'create';
  /** The system an action opens; `null` for "create", which opens the add-a-system box. */
  systemId: UUID | null;
  systemName: string;
  /** The capability an "extend" or "create" action is for; `null` when the decision names none. */
  capabilityName: string | null;
  /** True for "Build ourselves": the replacement is a custom-built app, not a product. */
  custom?: boolean;
  /** The product the option names (from its saved catalogue source); the replacement is created with this name. */
  product?: string;
}

export interface DraftSystem {
  id: UUID;
  name: string;
}

const MAX_PER_KIND = 3;

export function optionDraftActions(kind: OptionKind | null, concernedSystems: readonly DraftSystem[], supporters: readonly DraftSystem[], capabilityNames: readonly string[], product: string | null = null): OptionDraftAction[] {
  const capability = capabilityNames[0] ?? null;
  const unique = (systems: readonly DraftSystem[]) => [...new Map(systems.map((s) => [s.id, s])).values()];
  switch (kind) {
    case 'buy':
      return unique([...concernedSystems, ...supporters]).slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, capabilityName: capability, ...(product === null ? {} : { product }) }));
    case 'configure':
      return capability === null ? [] : unique([...concernedSystems, ...supporters]).slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'extend', systemId: s.id, systemName: s.name, capabilityName: capability }));
    case 'build': {
      const existing = unique([...concernedSystems, ...supporters]).slice(0, MAX_PER_KIND);
      if (existing.length > 0) return existing.map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, capabilityName: capability, custom: true }));
      return [{ kind: 'create', systemId: null, systemName: '', capabilityName: capability }];
    }
    case 'keep':
    case 'no_change':
    case null:
      return [];
  }
}

export function optionDraftLabel(action: OptionDraftAction): string {
  switch (action.kind) {
    case 'retire-and-replace':
      return `Retire ${action.systemName} and replace it with ${action.product ?? (action.custom ? 'a custom-built app' : 'a new system')}`;
    case 'extend':
      return `Extend ${action.systemName} to cover ${action.capabilityName ?? 'this'}`;
    case 'create':
      return action.capabilityName === null ? 'Create a new system' : `Create a new system for ${action.capabilityName}`;
  }
}
