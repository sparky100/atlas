/**
 * Starting points for "Draft with AI": each one is a short brief with blanks
 * that the person fills by picking real systems and capabilities from the
 * model (so the AI is never guessing which system "the CRM" means).
 *
 * These are wording only. Every template sticks to what the drafting prompt
 * (`src/capture/prompts/changeBrief.ts`) can actually propose: new systems,
 * uses/flows_to relationships between named systems, supports relationships
 * to a named capability, and a system's planned end date. Nothing here
 * promises dependency removals, because drafting does not infer them (the
 * `note` on a template says what is left to the reviewer). That is also why
 * there is no "move a capability" pill: moving means the old support stops,
 * which is a removal. A replacement asks for the `replaces` link (which moves
 * the old system's capability support across when applied), the old system's
 * lifecycle status set to retiring, and its planned end if a date is given,
 * because the prompt only does those when the brief says so explicitly.
 */
export type BriefSlotKind = 'system' | 'capability' | 'text' | 'date';

export interface BriefSlot {
  key: string;
  label: string;
  kind: BriefSlotKind;
  /** Left blank is fine: the brief just omits the sentence that uses it. */
  optional?: boolean;
}

export interface ChangeBriefTemplate {
  id: string;
  /** The pill's own label. */
  pill: string;
  /** Change title, with `{slotKey}` blanks. */
  title: string;
  /** Brief text, with `{slotKey}` blanks. */
  brief: string;
  /** Extra sentences added to the brief only when their optional slot is filled. */
  briefExtras?: readonly { slot: string; text: string }[];
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
    brief: 'Introduce {newSystem} as a planned system that replaces {oldSystem}. Set the lifecycle status of {oldSystem} to retiring.',
    briefExtras: [{ slot: 'endDate', text: 'The planned end of {oldSystem} is {endDate}.' }],
    slots: [
      { key: 'oldSystem', label: 'System being replaced', kind: 'system' },
      { key: 'newSystem', label: 'New system', kind: 'text' },
      { key: 'endDate', label: 'Old system ends on (optional)', kind: 'date', optional: true },
    ],
    note: 'Atlas adds the new system, links it to the old one, moves the old system\'s capability support across and marks the old one as retiring. Integrations and owners are not copied: the change page shows what is left once you apply it.',
  },
  {
    id: 'introduce-system',
    pill: 'Introduce a new system',
    title: 'Introduce {newSystem}',
    brief: 'Introduce {newSystem} as a planned system that supports {capability}.',
    briefExtras: [{ slot: 'goLive', text: '{newSystem} goes live on {goLive}.' }],
    slots: [
      { key: 'newSystem', label: 'New system', kind: 'text' },
      { key: 'capability', label: 'Capability it supports', kind: 'capability' },
      { key: 'goLive', label: 'Goes live on (optional)', kind: 'date', optional: true },
    ],
    note: 'It is added as an "Also" system for the capability. Owners and integrations are left for you to add.',
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
    id: 'add-capability-support',
    pill: 'Add a system to a capability',
    title: 'Add {system} to {capability}',
    brief: '{system} will also support {capability}.',
    slots: [
      { key: 'system', label: 'System', kind: 'system' },
      { key: 'capability', label: 'Capability', kind: 'capability' },
    ],
    note: 'It is added as an "Also" system. Anything it takes over from is left for you to change at review. To swap one whole system for another, use Replace a system.',
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

/** The whole brief: the base text plus each extra sentence whose optional blank has been filled. */
export function renderBrief(template: ChangeBriefTemplate, values: BriefSlotValues): string {
  const extras = (template.briefExtras ?? []).filter((extra) => valueOf(values, extra.slot) !== '').map((extra) => extra.text);
  return [template.brief, ...extras].map((text) => renderBriefText(text, template.slots, values)).join(' ');
}

/** Labels of the required blanks still to be filled, in the order they appear. */
export function missingBriefSlots(template: ChangeBriefTemplate, values: BriefSlotValues): string[] {
  return template.slots.filter((slot) => slot.optional !== true && valueOf(values, slot.key) === '').map((slot) => slot.label);
}
