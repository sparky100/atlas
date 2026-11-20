import type { UUID } from '../../contracts/delta';

/**
 * Deterministic starting edits for an option change that has none yet (no AI).
 * What is offered follows which option this is, because "Replace with a
 * product" and "Build ourselves" are different first edits:
 *   - keep      : nothing. "Keep and tidy up" starts from the existing system, so there is no obvious first edit.
 *   - configure : "Extend X to cover C" for a system that supports (or is named by) the decision.
 *   - replace   : "Retire X and replace it with a new system" for the system the decision names or the capability's supporter.
 *   - build     : "Create a new system for C".
 * An option whose title is not one of these gets nothing rather than a wrong suggestion.
 * Pure, so it is easy to test and never writes anything: each action only opens
 * the existing Retire panel, edit form or add-a-system box on this change.
 */
export type OptionKind = 'keep' | 'configure' | 'replace' | 'build';

export interface OptionDraftAction {
  kind: 'retire-and-replace' | 'extend' | 'create';
  /** The system an action opens; `null` for "create", which opens the add-a-system box. */
  systemId: UUID | null;
  systemName: string;
  /** The capability an "extend" or "create" action is for; `null` when the decision names none. */
  capabilityName: string | null;
}

export interface DraftSystem {
  id: UUID;
  name: string;
}

const MAX_PER_KIND = 3;

/** Reads which of the Designer's four options a title is. Anything else (a hand-written option, or a title a person changed) is `null`. */
export function optionKindOf(title: string): OptionKind | null {
  const t = title.trim().toLowerCase();
  if (/^keep\b/.test(t)) return 'keep';
  if (/^configure\b/.test(t)) return 'configure';
  if (/^replace\b/.test(t)) return 'replace';
  if (/^build\b/.test(t)) return 'build';
  return null;
}

export function optionDraftActions(kind: OptionKind | null, concernedSystems: readonly DraftSystem[], supporters: readonly DraftSystem[], capabilityNames: readonly string[]): OptionDraftAction[] {
  const capability = capabilityNames[0] ?? null;
  const unique = (systems: readonly DraftSystem[]) => [...new Map(systems.map((s) => [s.id, s])).values()];
  switch (kind) {
    case 'replace':
      return unique([...concernedSystems, ...supporters]).slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'retire-and-replace', systemId: s.id, systemName: s.name, capabilityName: capability }));
    case 'configure':
      return capability === null ? [] : unique([...concernedSystems, ...supporters]).slice(0, MAX_PER_KIND).map((s): OptionDraftAction => ({ kind: 'extend', systemId: s.id, systemName: s.name, capabilityName: capability }));
    case 'build':
      return [{ kind: 'create', systemId: null, systemName: '', capabilityName: capability }];
    case 'keep':
    case null:
      return [];
  }
}

export function optionDraftLabel(action: OptionDraftAction): string {
  switch (action.kind) {
    case 'retire-and-replace':
      return `Retire ${action.systemName} and replace it with a new system`;
    case 'extend':
      return `Extend ${action.systemName} to cover ${action.capabilityName ?? 'this'}`;
    case 'create':
      return action.capabilityName === null ? 'Create a new system' : `Create a new system for ${action.capabilityName}`;
  }
}
