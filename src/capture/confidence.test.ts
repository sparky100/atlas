import { describe, expect, it } from 'vitest';
import {
  clampMappingConfidence,
  existenceConf,
  groundingFactorFor,
  parseFactorFor,
  proseAttrConf,
  rowFactorFor,
  sheetAttrConf,
  updateConf,
} from './confidence';

describe('clampMappingConfidence', () => {
  it('is the LLM-only clamp — a synonym-table hit is the fixed constant 1.0 and never flows through this function at all', () => {
    expect(clampMappingConfidence(1)).toBe(0.9);
  });

  it('clips an LLM-reported confidence above 0.90 down to 0.90', () => {
    expect(clampMappingConfidence(0.99)).toBe(0.9);
  });

  it('clamps a negative value up to 0', () => {
    expect(clampMappingConfidence(-0.2)).toBe(0);
  });
});

describe('parseFactorFor', () => {
  it('is 1.0 (exact) when no discounting warning is present', () => {
    expect(parseFactorFor([])).toBe(1);
    expect(parseFactorFor(['MERGED_CELL'])).toBe(1);
  });

  it('applies each warning\'s own factor', () => {
    expect(parseFactorFor(['ENUM_FUZZY'])).toBe(0.95);
    expect(parseFactorFor(['AMBIGUOUS_DATE'])).toBe(0.8);
    expect(parseFactorFor(['MULTI_VALUE_CELL'])).toBe(0.9);
    expect(parseFactorFor(['ROWS_DISAGREE'])).toBe(0.9);
  });

  it('takes the lowest factor when more than one warning applies', () => {
    expect(parseFactorFor(['ENUM_FUZZY', 'AMBIGUOUS_DATE'])).toBe(0.8);
  });
});

describe('rowFactorFor', () => {
  it('is 0.95 for a merged range or formula error, else 1.0', () => {
    expect(rowFactorFor(true)).toBe(0.95);
    expect(rowFactorFor(false)).toBe(1);
  });
});

describe('sheetAttrConf', () => {
  it('multiplies the three factors, capped at 0.95', () => {
    expect(sheetAttrConf({ mappingConfidence: 1, parseFactor: 1, rowFactor: 1 })).toBe(0.95);
    expect(sheetAttrConf({ mappingConfidence: 0.9, parseFactor: 0.95, rowFactor: 1 })).toBeCloseTo(0.855, 5);
  });

  it('never exceeds the 0.95 sheet cap even if the inputs would multiply higher', () => {
    expect(sheetAttrConf({ mappingConfidence: 1, parseFactor: 1, rowFactor: 1 })).toBeLessThanOrEqual(0.95);
  });
});

describe('groundingFactorFor', () => {
  it('is 1.0 exact, 0.85 when the passage needed normalisation', () => {
    expect(groundingFactorFor(false)).toBe(1);
    expect(groundingFactorFor(true)).toBe(0.85);
  });
});

describe('proseAttrConf', () => {
  it('multiplies model confidence by grounding factor, capped at 0.90', () => {
    expect(proseAttrConf({ modelConfidence: 1, groundingFactor: 1 })).toBe(0.9);
    expect(proseAttrConf({ modelConfidence: 0.9, groundingFactor: 0.85 })).toBeCloseTo(0.765, 5);
  });
});

describe('existenceConf', () => {
  it('is the minimum confidence among the candidate\'s own asserted attributes', () => {
    expect(existenceConf([0.9, 0.6, 0.95])).toBe(0.6);
  });

  it('is 0 for an empty list, a defensive floor rather than Infinity', () => {
    expect(existenceConf([])).toBe(0);
  });
});

describe('updateConf', () => {
  it('is the minimum of the attribute confidence and the match confidence', () => {
    expect(updateConf(0.95, 0.6)).toBe(0.6);
    expect(updateConf(0.5, 0.95)).toBe(0.5);
  });
});
