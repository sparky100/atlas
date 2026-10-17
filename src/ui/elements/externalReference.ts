/**
 * What a person types into an element's "add external reference" box, turned
 * into the alias value stored: a pasted URL (`https://mprs.example.com/api/v1`)
 * keeps just its hostname, because that is what the MuleSoft converter looks
 * a backend up by; anything else is kept as typed, trimmed. Matching is
 * case-insensitive (the `aliases` unique index is on `lower(value)`).
 */
export function normaliseExternalReference(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const host = new URL(trimmed).hostname;
      return host === '' ? null : host;
    } catch {
      return null;
    }
  }
  return trimmed;
}
