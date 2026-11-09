import { describe, expect, it } from 'vitest';
import { lookupColumnSynonym } from './columnSynonyms';
import { validateImportRow } from './importRowSchema';
import { parseDisposition } from './normaliseValue';

describe('capture: disposition (F11)', () => {
  it('parses exact values plainly and TIME letters/register words as fuzzy; ambiguous words stay unparsed', () => {
    expect(parseDisposition('Migrate')).toEqual({ value: 'migrate', fuzzy: false });
    expect(parseDisposition(' eliminate ')).toEqual({ value: 'eliminate', fuzzy: false });
    expect(parseDisposition('T')).toEqual({ value: 'tolerate', fuzzy: true });
    expect(parseDisposition('Retire')).toEqual({ value: 'eliminate', fuzzy: true });
    expect(parseDisposition('Replace')).toEqual({ value: 'migrate', fuzzy: true });
    // The exporter writes the plain labels, so the importer takes them back (round trip).
    expect(parseDisposition('Keep as is')).toEqual({ value: 'tolerate', fuzzy: true });
    expect(parseDisposition('Move to another system')).toEqual({ value: 'migrate', fuzzy: true });
    expect(parseDisposition('Switch off')).toEqual({ value: 'eliminate', fuzzy: true });
    expect(parseDisposition('Modernise')).toBeNull();
    expect(parseDisposition('Review')).toBeNull();
  });

  it('maps TIME, Disposition and Rationalisation headers by synonym, never through prompt A', () => {
    expect(lookupColumnSynonym('TIME')).toBe('disposition');
    expect(lookupColumnSynonym('Disposition')).toBe('disposition');
    expect(lookupColumnSynonym('rationalisation')).toBe('disposition');
    expect(lookupColumnSynonym('Rationalization')).toBe('disposition');
  });

  it('the JSON import takes a disposition column, validated against the attribute schema', () => {
    const ok = validateImportRow({ name: 'Legacy CRM', disposition: 'eliminate' }, 1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.attributes.disposition).toBe('eliminate');
    expect(validateImportRow({ name: 'Legacy CRM', disposition: 'retain' }, 2).ok).toBe(false);
  });
});
