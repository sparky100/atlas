import { INTEGRATION_PROTOCOL_LABELS } from '../../../contracts/relationshipAttributeSchema';

/** ADR-026: "File (SFTP) in → REST API out", or one side alone, or the single direct-flow protocol read as both sides; null when none is recorded. */
export function protocolSides(attrs: Record<string, unknown>): string | null {
  const label = (value: unknown): string | null => (typeof value === 'string' && value in INTEGRATION_PROTOCOL_LABELS ? INTEGRATION_PROTOCOL_LABELS[value as keyof typeof INTEGRATION_PROTOCOL_LABELS] : typeof value === 'string' && value.trim() !== '' ? value : null);
  const inLabel = label(attrs.protocolIn) ?? label(attrs.protocol);
  const outLabel = label(attrs.protocolOut) ?? label(attrs.protocol);
  if (inLabel === null && outLabel === null) return null;
  if (inLabel !== null && outLabel !== null) return inLabel === outLabel ? inLabel : `${inLabel} in → ${outLabel} out`;
  return inLabel !== null ? `${inLabel} in` : `${outLabel ?? ''} out`;
}
