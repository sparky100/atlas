/** The one place the supports edge's `role` attribute gets a user-facing word. `primary`/`secondary` are the stored values (SPEC); users see "Main" and "Also" so a system's single main capability reads differently from the others it supports. */
export function supportsRoleLabel(role: string): string {
  if (role === 'primary') return 'Main';
  if (role === 'secondary') return 'Also';
  return role;
}
