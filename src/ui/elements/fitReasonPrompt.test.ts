import { describe, expect, it } from 'vitest';
import { RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE } from '../../contracts/relationshipAttributeSchema';
import { fitReasonField } from './fitReasonPrompt';

const notes = RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.supports.find((f) => f.key === 'fitForPurposeNotes');
const role = RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.supports.find((f) => f.key === 'role');

describe('fitReasonField', () => {
  it('asks "What is the problem?" for a poor or adequate fit', () => {
    expect(notes && fitReasonField(notes, 'poor', '')?.label).toBe('What is the problem?');
    expect(notes && fitReasonField(notes, 'adequate', '')?.label).toBe('What is the problem?');
  });
  it('stays out of the way for a good or unrated fit with no note, and keeps an existing note', () => {
    expect(notes && fitReasonField(notes, 'good', '')).toBeNull();
    expect(notes && fitReasonField(notes, '', '')).toBeNull();
    expect(notes && fitReasonField(notes, 'good', 'old note')?.label).toBe('Fit notes');
  });
  it('leaves every other field alone', () => {
    expect(role && fitReasonField(role, 'poor', '')).toBe(role);
  });
});
