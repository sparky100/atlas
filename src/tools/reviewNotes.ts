/**
 * D2: the reviewer's output contract, parsed in code and never trusted as
 * prose. Up to five notes, each a plain sentence, what it is based on, and a
 * question for the person. Anything that reads like a verdict (pass, fail,
 * compliant, approved, recommend), a score, or has no question is dropped
 * and counted.
 */
export interface ReviewBasedOn {
  kind: 'option' | 'element' | 'none';
  branchId?: string;
  elementId?: string;
  label: string;
}

export interface ReviewNote {
  note: string;
  basedOn: ReviewBasedOn;
  question: string;
}

export interface ParsedReviewNotes {
  notes: ReviewNote[];
  /** What was dropped and why, for an honest "N notes could not be used" line. */
  problems: string[];
}

export const REVIEW_NOTES_MAX = 5;
const NOTE_MAX = 600;
const LABEL_MAX = 200;
const QUESTION_MAX = 500;

const VERDICT_WORDS = /(^|\b)(pass|fail|compliant|approved|recommend)(ed|s)?(\b|$)/i;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function extractJson(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer);
  const candidate = fenced?.[1] ?? answer;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function basedOn(raw: unknown): ReviewBasedOn {
  if (typeof raw !== 'object' || raw === null) return { kind: 'none', label: 'Not tied to a record' };
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'option' || r.kind === 'element' ? r.kind : 'none';
  if (kind === 'none') return { kind: 'none', label: 'Not tied to a record' };
  const id = kind === 'option' ? r.branchId : r.elementId;
  const idString = typeof id === 'string' && UUID_SHAPE.test(id) ? id : undefined;
  if (idString === undefined) return { kind: 'none', label: 'Not tied to a record' };
  const label = text(r.label, LABEL_MAX);
  return kind === 'option' ? { kind, branchId: idString, label } : { kind, elementId: idString, label };
}

export function parseReviewNotes(answer: string): ParsedReviewNotes {
  const parsed = extractJson(answer);
  if (typeof parsed !== 'object' || parsed === null) {
    return { notes: [], problems: ['The reviewer did not return notes in a form Atlas can use.'] };
  }
  const raw = (parsed as { notes?: unknown }).notes;
  if (!Array.isArray(raw)) return { notes: [], problems: ['The reviewer returned no list of notes.'] };

  const notes: ReviewNote[] = [];
  let dropped = 0;
  for (const entry of raw) {
    if (notes.length >= REVIEW_NOTES_MAX) break;
    if (typeof entry !== 'object' || entry === null) {
      dropped += 1;
      continue;
    }
    const r = entry as Record<string, unknown>;
    const note = text(r.note, NOTE_MAX);
    const question = text(r.question, QUESTION_MAX);
    if (note === '' || question === '' || VERDICT_WORDS.test(note) || VERDICT_WORDS.test(question)) {
      dropped += 1;
      continue;
    }
    notes.push({ note, basedOn: basedOn(r.basedOn), question });
  }
  const problems: string[] = [];
  if (dropped > 0) problems.push(dropped === 1 ? 'One note was left out because it was not a usable question.' : `${String(dropped)} notes were left out because they were not usable questions.`);
  return { notes, problems };
}
