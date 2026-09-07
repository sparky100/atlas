import { describe, expect, it } from 'vitest';
import { LEGACY_SECTOR_ALIASES, parseCapabilityMapContent, SECTORS } from './capabilityMapContent';

interface MutableItem {
  code: string;
  name: string;
  level: number;
  parentCode: string | null;
}

interface MutableContent {
  sector: string;
  version: number;
  status: string;
  sourceDescription: string;
  sources: { citation: string; reviewedBy: string; reviewedAt: string }[];
  items: MutableItem[];
}

function validContent(): MutableContent {
  return {
    sector: 'local_government_scotland',
    version: 1,
    status: 'draft',
    sourceDescription: 'A test map',
    sources: [{ citation: 'Some framework', reviewedBy: 'Jane Reviewer', reviewedAt: '2026-01-01' }],
    items: [
      { code: '1', name: 'Root', level: 1, parentCode: null },
      { code: '1.1', name: 'Child', level: 2, parentCode: '1' },
    ],
  };
}

function child(content: MutableContent): MutableItem {
  const item = content.items[1];
  if (!item) throw new Error('expected a second item');
  return item;
}

function root(content: MutableContent): MutableItem {
  const item = content.items[0];
  if (!item) throw new Error('expected a first item');
  return item;
}

describe('parseCapabilityMapContent', () => {
  it('accepts well-formed content', () => {
    const parsed = parseCapabilityMapContent(validContent(), 'test.json');
    expect(parsed.items).toHaveLength(2);
  });

  it('rejects a root item whose level is not 1', () => {
    const content = validContent();
    root(content).level = 2;
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow(/must have level 1/);
  });

  it('rejects a child item whose level does not follow its parent', () => {
    const content = validContent();
    child(content).level = 3;
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow(/one more than its parent/);
  });

  it('rejects a parentCode that matches no item', () => {
    const content = validContent();
    child(content).parentCode = 'missing';
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow(/does not match any item/);
  });

  it('rejects duplicate item codes', () => {
    const content = validContent();
    child(content).code = '1';
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow(/unique/);
  });

  it('rejects an unknown sector', () => {
    const content = validContent();
    content.sector = 'not-a-sector';
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow();
  });

  it('rejects a map with zero items', () => {
    const content = validContent();
    content.items = [];
    expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow();
  });

  // The sector list is the contract's, not a database CHECK's, as of
  // 20260906180000_capability_maps_sector_taxonomy_in_code.sql — so this
  // is the round-trip test rule 1 asks for: every canonical value parses,
  // and the value the database used to accept but the contract retired
  // ('generic', renamed public_body) no longer does.
  describe('sectors (taxonomy in code)', () => {
    it.each(SECTORS)('accepts canonical sector %s unchanged', (sector) => {
      const content = validContent();
      content.sector = sector;
      expect(parseCapabilityMapContent(content, 'test.json').sector).toBe(sector);
    });

    it('parses the deprecated local_government alias as local_government_scotland', () => {
      const content = validContent();
      content.sector = 'local_government';
      expect(parseCapabilityMapContent(content, 'test.json').sector).toBe('local_government_scotland');
      expect(LEGACY_SECTOR_ALIASES.local_government).toBe('local_government_scotland');
    });

    it("rejects the retired 'generic' sector (renamed public_body, not aliased)", () => {
      const content = validContent();
      content.sector = 'generic';
      expect(() => parseCapabilityMapContent(content, 'test.json')).toThrow();
    });

    it('lists exactly the eight sectors the starter content covers', () => {
      expect([...SECTORS]).toEqual(['local_government_scotland', 'local_government_england', 'nhs', 'housing', 'hei', 'public_body', 'utility', 'electricity_network']);
    });
  });
});
