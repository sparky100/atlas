import { describe, expect, it } from 'vitest';
import { buildPromptCCapabilityTreeBlock, buildPromptCUserMessage, PROMPT_C_SCHEMA, PROMPT_C_SYSTEM } from './c';

describe('PROMPT_C_SYSTEM', () => {
  it('rules out inventing a capability not in the tree', () => {
    expect(PROMPT_C_SYSTEM).toContain('do not propose a new capability');
  });
});

describe('PROMPT_C_SCHEMA', () => {
  it('is strict with assignments required', () => {
    expect(PROMPT_C_SCHEMA.additionalProperties).toBe(false);
    expect(PROMPT_C_SCHEMA.required).toEqual(['assignments']);
  });
});

describe('buildPromptCCapabilityTreeBlock', () => {
  it('renders one line per capability with its parent code', () => {
    const block = buildPromptCCapabilityTreeBlock([
      { code: '1', name: 'Finance', parentCode: null, description: 'Money things.' },
      { code: '1.1', name: 'Payroll', parentCode: '1' },
    ]);
    expect(block).toContain('1 | Finance | parent: (none) | Money things.');
    expect(block).toContain('1.1 | Payroll | parent: 1 | ');
  });
});

describe('buildPromptCUserMessage', () => {
  it('renders the seq | name | text | description row shape and truncates long descriptions', () => {
    const longDescription = 'x'.repeat(250);
    const message = buildPromptCUserMessage([
      { seq: 1, systemName: 'Payroll System', capabilityColumnText: 'HR and payroll', description: 'Handles pay.' },
      { seq: 2, systemName: 'Long Desc System', capabilityColumnText: 'Finance', description: longDescription },
    ]);
    expect(message).toContain('Rows:');
    expect(message).toContain('1 | Payroll System | HR and payroll | Handles pay.');
    expect(message).toContain('2 | Long Desc System | Finance | ' + 'x'.repeat(200) + '…');
    expect(message).not.toContain(longDescription);
  });
});
