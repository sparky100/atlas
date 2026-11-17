import { describe, expect, it } from 'vitest';
import vocabulary from '../../../docs/VOCABULARY.md?raw';
import guide from '../../../docs/USER-GUIDE.md?raw';
import { buildHelpAssistantSystemPrompt } from './helpAssistantPrompt';
import { askSystemPrompt } from '../../tools/askPrompt';
import { atlasVocabularyForAi } from '../../tools/vocabularyForAi';
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

describe('docs/USER-GUIDE.md and Help use the same words', () => {
  it('names every health finding by the label the app shows', () => {
    for (const option of FINDING_FILTER_OPTIONS.filter((o) => o.value !== '')) expect(guide.toLowerCase()).toContain(option.label.toLowerCase());
  });

  it('explains every relationship type in bold', () => {
    for (const type of RELATIONSHIP_TYPES) expect(guide).toContain(`**${type.replace('_', ' ')}**`);
  });

  it('names every planned action by its label', () => {
    for (const level of DISPOSITION_LEVELS) expect(guide).toContain(level.label);
  });

  it('says "planned action", not "disposition", except where it names an older heading', () => {
    const lines = guide.split('\n').filter((l) => /disposition/i.test(l));
    for (const line of lines) expect(line).toMatch(/older headings|stored internally|older word/);
  });

  it('gives the Help assistant the vocabulary as well as the guide', () => {
    const prompt = buildHelpAssistantSystemPrompt();
    expect(prompt).toContain('=== VOCABULARY ===');
    expect(prompt).toContain('**Which one, uses or flows to?**');
  });
});

describe('Ask Atlas explains the model in the same words', () => {
  const prompt = askSystemPrompt('Test model', '2026-11-17');

  it('includes the vocabulary block', () => {
    expect(prompt).toContain(atlasVocabularyForAi());
  });

  it('explains every relationship type, by its stored name or as people read it', () => {
    for (const type of RELATIONSHIP_TYPES) expect(prompt).toContain(type);
  });

  it('names every planned action and run cost band as the app does', () => {
    for (const level of DISPOSITION_LEVELS) expect(prompt).toContain(level.label);
    for (const band of ANNUAL_RUN_COST_BANDS) expect(prompt).toContain(band.label);
  });

  it('tells the assistant to answer for today and to say when planned or retired systems are left out', () => {
    expect(prompt).toMatch(/answer for today/i);
    expect(prompt).toMatch(/planned and retired systems are left out/i);
  });

  it('keeps the uses versus flows_to rule the vocabulary states', () => {
    expect(vocabulary).toContain('does data travel from A to B?');
    expect(prompt).toContain('does data travel from A to B?');
  });
});
