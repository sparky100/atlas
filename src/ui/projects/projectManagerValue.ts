import type { UUID } from '../../contracts/delta';

/** The project manager as the form holds it: an Atlas user, a plain name, or nobody. */
export interface ProjectManagerValue {
  managerId: UUID | null;
  /** Plain-text name when the PM isn't an Atlas user; `''` when none. */
  managerName: string;
  /** True once "Someone else" is chosen, even before a name is typed. */
  typing: boolean;
}

export const NO_PROJECT_MANAGER: ProjectManagerValue = { managerId: null, managerName: '', typing: false };

export function projectManagerFromRow(row: { project_manager_id: UUID | null; project_manager_name: string | null }): ProjectManagerValue {
  return { managerId: row.project_manager_id, managerName: row.project_manager_name ?? '', typing: row.project_manager_name !== null };
}

/** What to send to the database: at most one of the two is set (migration check). */
export function projectManagerToInput(value: ProjectManagerValue): { projectManagerId: UUID | null; projectManagerName: string | null } {
  if (value.typing) {
    const name = value.managerName.trim();
    return { projectManagerId: null, projectManagerName: name === '' ? null : name };
  }
  return { projectManagerId: value.managerId, projectManagerName: null };
}
