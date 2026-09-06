import { describe, expect, it } from 'vitest';
import { parseCapabilityMapContent } from './capabilityMapContent';

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
    sector: 'local_government',
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
});
