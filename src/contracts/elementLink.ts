/**
 * Document links on an element (ADR-030). A pointer to where a document
 * lives — never the document itself. Pure; no I/O.
 */

export type ElementLinkKind = 'link' | 'reference';

export interface ElementLinkInput {
  label: string;
  pointer: string;
}

export type ElementLinkResult =
  | { ok: true; value: { label: string; pointer: string; kind: ElementLinkKind } }
  | { ok: false; error: string };

const WEB_LINK = /^https?:\/\/\S+$/i;

/** True for a pointer that is a web link (http or https, no spaces). */
export function isWebLink(pointer: string): boolean {
  return WEB_LINK.test(pointer.trim());
}

/**
 * Trims and classifies a label + pointer. A pointer starting http:// or
 * https:// must be a valid link; anything else is a plain reference, but
 * other web schemes (javascript:, ftp:, file:) are refused outright.
 */
export function validateElementLink(input: ElementLinkInput): ElementLinkResult {
  const label = input.label.trim();
  const pointer = input.pointer.trim();
  if (label === '') return { ok: false, error: 'Give the document a name.' };
  if (pointer === '') return { ok: false, error: 'Say where the document lives: a link, or a place such as SharePoint › Business cases.' };
  if (/^https?:\/\//i.test(pointer)) {
    if (!WEB_LINK.test(pointer)) return { ok: false, error: 'That link has spaces in it. Paste the full address, starting with https://.' };
    return { ok: true, value: { label, pointer, kind: 'link' } };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pointer) || /^(javascript|data|vbscript|file):/i.test(pointer)) {
    return { ok: false, error: 'A link must start with http:// or https://. Otherwise describe where the document lives.' };
  }
  return { ok: true, value: { label, pointer, kind: 'reference' } };
}
