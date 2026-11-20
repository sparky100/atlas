import { describe, expect, it } from 'vitest';
import { roleForNewSupporter } from './firstSupporterRole';

const edge = (to: string, role: string) => ({ to_element_id: to, attributes: { role } });
describe('roleForNewSupporter', () => {
  it('is primary when the capability has no primary supporter', () => {
    expect(roleForNewSupporter([], 'cap')).toBe('primary');
    expect(roleForNewSupporter([edge('cap', 'secondary')], 'cap')).toBe('primary');
  });
  it('is secondary once the capability has a primary supporter', () => {
    expect(roleForNewSupporter([edge('cap', 'primary')], 'cap')).toBe('secondary');
  });
  it('ignores other capabilities', () => {
    expect(roleForNewSupporter([edge('other', 'primary')], 'cap')).toBe('primary');
  });
});
