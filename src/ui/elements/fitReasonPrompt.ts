import type { AttributeFieldSchema } from '../../contracts/attributeSchema';

/**
 * When someone rates how well a system fits a capability as poor or adequate, the form asks the one question that
 * makes the rating useful: "What is the problem?". It is the existing Fit notes field (no schema change), optional,
 * and shown under the rating instead of waiting to be found. For a good or unrated fit with no note it stays out of the way.
 */
export function fitReasonField(field: AttributeFieldSchema, fitValue: unknown, noteValue: unknown): AttributeFieldSchema | null {
  if (field.key !== 'fitForPurposeNotes') return field;
  const fit = typeof fitValue === 'string' ? fitValue : '';
  const note = typeof noteValue === 'string' ? noteValue : '';
  const asksForReason = fit === 'poor' || fit === 'adequate';
  if (!asksForReason && note.trim() === '') return null;
  return asksForReason ? { ...field, label: 'What is the problem?', help: 'Optional. One plain sentence on why it falls short. It is shown on the capability and can start a project.' } : field;
}
