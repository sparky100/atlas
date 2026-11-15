import { describe, expect, it } from 'vitest';
import { parseSamplePayload, SAMPLE_SLUG_PATTERN, type SamplePayload } from './sampleModel';

const valid: SamplePayload = {
  elementsHead: [],
  relationshipsHead: [],
  facts: [],
  sources: [{ id: 's1', kind: 'template', name: 'Electricity network', uri: null, captured_at: null, capability_map_id: 'm1' }],
  aliases: [{ element_id: 'e1', alias_value: 'SAP PM', alias_type: 'name', source_id: 's1', confidence: 1 }],
};

describe('parseSamplePayload', () => {
  it('round-trips a payload through JSON unchanged (the database stores it as jsonb)', () => {
    expect(parseSamplePayload(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('names the first thing wrong', () => {
    expect(() => parseSamplePayload({ ...valid, sources: [{ ...valid.sources[0], kind: 'nonsense' }] })).toThrow(/sources\.0\.kind/);
    expect(() => parseSamplePayload({ ...valid, aliases: [{ ...valid.aliases[0], alias_type: 'merged_id' }] })).toThrow(/aliases\.0\.alias_type/);
    expect(() => parseSamplePayload({ ...valid, facts: 'no' })).toThrow(/facts/);
    expect(() => parseSamplePayload(null)).toThrow();
  });
});

describe('SAMPLE_SLUG_PATTERN', () => {
  it('accepts lowercase words joined by single hyphens only', () => {
    for (const ok of ['northbridge-dno', 'a', 'meridian-retail-2']) expect(SAMPLE_SLUG_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'Northbridge', 'a--b', '-a', 'a-', 'a b']) expect(SAMPLE_SLUG_PATTERN.test(bad)).toBe(false);
  });
});
