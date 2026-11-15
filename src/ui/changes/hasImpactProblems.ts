import type { ImpactProblems } from '../../engine/changeImpactProblems';

/** True when a change causes at least one problem worth showing (nothing is shown otherwise). */
export function hasImpactProblems(problems: ImpactProblems): boolean {
  return problems.capabilitiesLeftWithoutSystem.length > 0 || problems.providerProblems.length > 0;
}
