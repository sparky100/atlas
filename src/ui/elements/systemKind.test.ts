import { describe, expect, it } from 'vitest';
import { isIntegrationPlatform, isNonApplicationKind, kindOf } from './systemKind';
import type { ElementsHeadRow, Json } from '../../contracts/rows';

function system(kind?: string): ElementsHeadRow {
  const attributes: Record<string, Json> = { isExternal: false };
  if (kind !== undefined) attributes.kind = kind;
  return { element_id: 'sys-1', element_type: 'system', name: 'System', parent_id: null, attributes, exists_delta_id: 'd-sys-1' };
}

describe('kindOf (Prompt 7k item 4)', () => {
  it('reads a recorded kind', () => {
    expect(kindOf(system('integration_platform'))).toBe('integration_platform');
    expect(kindOf(system('data_platform'))).toBe('data_platform');
    expect(kindOf(system('infrastructure'))).toBe('infrastructure');
  });

  it('defaults to application when absent', () => {
    expect(kindOf(system())).toBe('application');
  });

  it('defaults to application for an unrecognised value', () => {
    expect(kindOf(system('nonsense'))).toBe('application');
  });
});

describe('isIntegrationPlatform', () => {
  it('is true only for kind: integration_platform', () => {
    expect(isIntegrationPlatform(system('integration_platform'))).toBe(true);
    expect(isIntegrationPlatform(system('data_platform'))).toBe(false);
    expect(isIntegrationPlatform(system())).toBe(false);
  });
});

describe('isNonApplicationKind', () => {
  it('is false for application (explicit or default), true for every other kind', () => {
    expect(isNonApplicationKind(system())).toBe(false);
    expect(isNonApplicationKind(system('application'))).toBe(false);
    expect(isNonApplicationKind(system('integration_platform'))).toBe(true);
    expect(isNonApplicationKind(system('data_platform'))).toBe(true);
    expect(isNonApplicationKind(system('infrastructure'))).toBe(true);
  });
});
