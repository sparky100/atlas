import { describe, expect, it } from 'vitest';
import { projectManagerFromRow, projectManagerToInput } from './projectManagerValue';

describe('project manager form value', () => {
  it('sends a member as an id and no name', () => {
    expect(projectManagerToInput({ managerId: 'u1', managerName: '', typing: false })).toEqual({ projectManagerId: 'u1', projectManagerName: null });
  });
  it('sends a typed name as trimmed text and no id', () => {
    expect(projectManagerToInput({ managerId: null, managerName: '  Priya Shah ', typing: true })).toEqual({ projectManagerId: null, projectManagerName: 'Priya Shah' });
  });
  it('treats "someone else" with a blank name as no project manager', () => {
    expect(projectManagerToInput({ managerId: null, managerName: '   ', typing: true })).toEqual({ projectManagerId: null, projectManagerName: null });
  });
  it('round-trips each stored shape back into the form', () => {
    expect(projectManagerFromRow({ project_manager_id: null, project_manager_name: null })).toEqual({ managerId: null, managerName: '', typing: false });
    expect(projectManagerFromRow({ project_manager_id: 'u1', project_manager_name: null })).toEqual({ managerId: 'u1', managerName: '', typing: false });
    expect(projectManagerFromRow({ project_manager_id: null, project_manager_name: 'Priya' })).toEqual({ managerId: null, managerName: 'Priya', typing: true });
  });
});
