/**
 * Older option labels still carry a change-intent prefix ("Exploring: ",
 * "Proposing: ", "Recording: "). A person reads the option's own name, never
 * the intent line, so every person-facing surface strips it in one place.
 */
const INTENT_PREFIX = /^(?:Exploring|Proposing|Recording):\s*/;

export function stripIntentPrefix(label: string): string {
  return label.replace(INTENT_PREFIX, '').trim();
}
