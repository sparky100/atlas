import { describe, expect, it } from 'vitest';
import vocabulary from '../../../docs/VOCABULARY.md?raw';
import { RELATIONSHIP_TYPES } from '../../contracts/delta';
import { AI_AUTONOMY_LABELS, AI_USE_LABELS, ANNUAL_RUN_COST_BANDS, DISPOSITION_LEVELS } from '../../contracts/attributeSchema';
import { DISPOSITION_NOT_ASSESSED_LABEL } from '../../engine/elementRead/disposition';
import { FINDING_FILTER_OPTIONS } from '../../db/elementBrowse';

/** The vocabulary is the one place Atlas's words are defined; this keeps it honest against the code. */
describe('docs/VOCABULARY.md', () => {
  it('names every relationship type, spelled as people read it', () => {
    for (const type of RELATIONSHIP_TYPES) expect(vocabulary).toContain(`**${type.replace('_', ' ')}**`);
  });

  it('names every planned action by its label and its stored name, and the unset wording', () => {
    for (const level of DISPOSITION_LEVELS) expect(vocabulary).toContain(`${level.label} (${level.key})`);
    expect(vocabulary).toContain(DISPOSITION_NOT_ASSESSED_LABEL);
  });

  it('names every run cost band', () => {
    for (const band of ANNUAL_RUN_COST_BANDS) expect(vocabulary).toContain(band.label);
  });

  it('names every AI option by the label the app shows', () => {
    for (const label of [...Object.values(AI_AUTONOMY_LABELS), ...Object.values(AI_USE_LABELS)]) expect(vocabulary).toContain(label);
  });

  it('lists every health finding by the label the app shows', () => {
    for (const option of FINDING_FILTER_OPTIONS.filter((o) => o.value !== '')) expect(vocabulary).toContain(`- ${option.label}`);
  });
});
