/**
 * Starting points for "Draft with AI": each one is a short brief with blanks
 * that the person fills by picking real systems and capabilities from the
 * model (so the AI is never guessing which system "the CRM" means).
 *
 * These are wording only. Every template sticks to what the drafting prompt
 * (`src/capture/prompts/changeBrief.ts`) can actually propose: new systems,
 * uses/flows_to relationships between named systems, supports relationships
 * to a named capability, and a system's planned end date. Nothing here
 * promises retirements or dependency removals, because drafting does not
 * infer them (the `note` on a template says what is left to the reviewer).
 */
export type BriefSlotKind = 'system' | 'capability' | 'text' | 'date';

export interface BriefSlot {
  key: string;
  label: string;
  kind: BriefSlotKind;
}

export interface ChangeBriefTemplate {
  id: string;
  /** The pill's own label. */
  pill: string;
  /** Change title, with `{slotKey}` blanks. */
  title: string;
  /** Brief text, with `{slotKey}` blanks. */
  brief: string;
  slots: readonly BriefSlot[];
  /** What Atlas will not decide for the person; shown under the blanks. */
  note?: string;
}

export interface BriefSlotValue {
  name: string;
}

export type BriefSlotValues = Readonly<Record<string, BriefSlotValue | undefined>>;

export const CHANGE_BRIEF_TEMPLATES: readonly ChangeBriefTemplate[] = [
  {
    id: 'replace-system',
    pill: 'Replace a system',
    title: 'Replace {oldSystem} with {newSystem}',
    brief: 'Introduce {newSystem} to replace {oldSystem}.',
    slots: [
      { key: 'oldSystem', label: 'System being replaced', kind: 'system' },
      { key: 'newSystem', label: 'New system', kind: 'text' },
    ],
    note: 'Atlas adds the new system. What happens to the old one, and its links, is yours to decide when you review.',
  },
  {
    id: 'introduce-system',
    pill: 'Introduce a new system',
    title: 'Introduce {newSystem}',
    brief: 'Introduce {newSystem} to support {capability}.',
    slots: [
      { key: 'newSystem', label: 'New system', kind: 'text' },
      { key: 'capability', label: 'Capability it supports', kind: 'capability' },
    ],
  },
  {
    id: 'add-integration',
    pill: 'Add an integration',
    title: 'Connect {from} to {to}',
    brief: '{from} will send data to {to}.',
    slots: [
      { key: 'from', label: 'Sends data', kind: 'system' },
      { key: 'to', label: 'Receives data', kind: 'system' },
    ],
  },
  {
    id: 'move-capability',
    pill: 'Move a capability',
    title: 'Move {capability} to {system}',
    brief: '{capability} will move to be supported by {system}.',
    slots: [
      { key: 'capability', label: 'Capability', kind: 'capability' },
      { key: 'system', label: 'Moves to', kind: 'system' },
    ],
    note: 'Atlas adds the new support. The existing support stays until you change it when you review.',
  },
  {
    id: 'plan-end',
    pill: 'Plan an end date',
    title: 'Plan the end of {system}',
    brief: '{system} will reach its planned end on {date}.',
    slots: [
      { key: 'system', label: 'System', kind: 'system' },
      { key: 'date', label: 'Planned end date', kind: 'date' },
    ],
  },
];

function valueOf(values: BriefSlotValues, key: string): string {
  return values[key]?.name.trim() ?? '';
}

/** Fills `{key}` blanks from the chosen values; an unfilled blank reads as `[Its label]`. */
export function renderBriefText(text: string, slots: readonly BriefSlot[], values: BriefSlotValues): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const slot = slots.find((s) => s.key === key);
    if (!slot) return whole;
    const value = valueOf(values, key);
    return value !== '' ? value : `[${slot.label}]`;
  });
}

/** Labels of the blanks still to be filled, in the order they appear. */
export function missingBriefSlots(template: ChangeBriefTemplate, values: BriefSlotValues): string[] {
  return template.slots.filter((slot) => valueOf(values, slot.key) === '').map((slot) => slot.label);
}
