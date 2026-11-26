import type { UUID } from '../../contracts/delta';
import type { OptionApproach } from '../../contracts/optionApproach';

/**
 * Deterministic starting edits for an option change that has none yet (no AI).
 * Systems the decision names come first and are the only ones offered; the capability's supporters are used only when it names none.
 * What is offered follows the option's stored approach
 * (`decision_options.approach`), because buying a product and building
 * ourselves are different first edits:
 *   - keep      : nothing. "Keep and tidy up" starts from the existing system, so there is no obvious first edit.
 *   - configure : "Extend X to cover C" for a system that supports (or is named by) the decision.
 *   - use       : the same first edit as buy: the replacement is a system or module already in the model, found first in the Retire panel.
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
  /** The system is a module of a platform; the label says so. */
  module?: boolean;
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
  /** A module (a container of a platform), not a whole system. */
  module?: boolean;
}

const MAX_PER_KIND = 3;

export function optionDraftActions(kind: OptionKind | null, concernedSystems: readonly DraftSystem[], supporters: readonly DraftSystem[], capabilityNames: readonly string[], product: string | null = null): OptionDraftAction[] {
  const capability = capabilityNames[0] ?? null;
  const unique = (systems: readonly DraftSystem[]) => [...new Map(systems.map((s) => [s.id, s])).values()];
  // The decision already says which system it is about: offer only those. The capability's other
  // supporters are a fallback for a decision that names none (it is about the capability itself).
  // A module of a platform that merely supports the capability is never suggested: replacing it is a
  // different decision from replacing the platform. A module is offered only when the decision names it.
  const candidates = () => unique(concernedSystems.length > 0 ? concernedSystems : supporters.filter((s) => s.module !== true));
  switch (kind) {
    case 'buy':
    case 'use':
      return candidates().slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, ...(s.module === true ? { module: true } : {}), capabilityName: capability, ...(product === null ? {} : { product }) }));
    case 'configure':
      return capability === null ? [] : candidates().slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'extend', systemId: s.id, systemName: s.name, ...(s.module === true ? { module: true } : {}), capabilityName: capability }));
    case 'build': {
      const existing = candidates().slice(0, MAX_PER_KIND);
      if (existing.length > 0) return existing.map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, ...(s.module === true ? { module: true } : {}), capabilityName: capability, custom: true }));
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
      return `Retire ${action.module === true ? 'the ' : ''}${action.systemName}${action.module === true ? ' module' : ''} and replace it with ${action.product ?? (action.custom ? 'a custom-built app' : 'a new system')}`;
    case 'extend':
      return `Extend ${action.module === true ? 'the ' : ''}${action.systemName}${action.module === true ? ' module' : ''} to cover ${action.capabilityName ?? 'this'}`;
    case 'create':
      return action.capabilityName === null ? 'Create a new system' : `Create a new system for ${action.capabilityName}`;
  }
}
