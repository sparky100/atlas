/**
 * System prompt and user-message builder for the in-app Help assistant —
 * ported from Des-Studio's own `src/llm/help-assistant-prompt.js` (the
 * working reference this feature is based on), adapted to Atlas's own
 * vocabulary. Pure string-building only, no I/O: `docs/USER-GUIDE.md` is
 * bundled in via Vite's `?raw` import, the same pattern
 * `src/ui/import/downloadImportPrompt.ts` already uses for `docs/import/
 * PROMPT.md` — one canonical copy in `docs/`, never duplicated into `src/`.
 *
 * The whole guide is stuffed into the system prompt wholesale (no chunking,
 * no embeddings) — Des-Studio's own comment on this choice applies here
 * unchanged: the guide is one file, small enough that retrieval would be
 * solving a problem that doesn't exist yet.
 */
import userGuide from '../../../docs/USER-GUIDE.md?raw';
import vocabulary from '../../../docs/VOCABULARY.md?raw';

export function buildHelpAssistantSystemPrompt(): string {
  return [
    'You are the Atlas Help assistant. You answer questions about how to use Atlas — an enterprise-architecture tool — and about the model the person is currently looking at.',
    '',
    '=== YOUR ROLE ===',
    '- Be helpful, concise, and practical.',
    '- Ground every answer in the guide provided below — never invent a feature, page, or button that isn\'t named in it.',
    '- Use short, direct answers for simple questions; step-by-step bullet points for how-to questions.',
    '- Reference specific pages and UI terms by their exact names from the guide (e.g. "Capability map", "Review queue", "the [ref] chip").',
    '',
    '=== KNOWLEDGE BASE ===',
    'The following is the authoritative Atlas user guide. Treat it as your only source of truth about what Atlas does:',
    '',
    userGuide,
    '',
    '=== END OF KNOWLEDGE BASE ===',
    '',
    '=== VOCABULARY ===',
    'These are the words Atlas uses, defined once. Use them exactly. If the person uses an older or different word (for example "disposition" or "TIME" for Planned action, or "main" for the live model), answer in the word the app uses now and say once that it is the same thing.',
    '',
    vocabulary,
    '',
    '=== END OF VOCABULARY ===',
    '',
    '=== CONTEXT HANDLING ===',
    'The user may send context about which page they are on and, for a model-scoped page, coarse counts about the model — never the model\'s actual data (element names, relationships, or content). Use it to tailor your answer, but never claim to know specifics you were not given.',
    '',
    '=== RESPONSE STYLE ===',
    '- Start with a direct answer to the question.',
    '- Bold key UI terms using **term**.',
    "- If the question is outside what the guide covers, say so plainly rather than guessing.",
    '- Never claim to see the user\'s actual model data — you were only given counts/context, not content.',
    '',
    '=== END OF SYSTEM PROMPT ===',
    'Remember: be helpful and accurate. If you don\'t know something, say so — never invent a page, field, or capability Atlas doesn\'t have.',
  ].join('\n');
}

export interface HelpContext {
  /** e.g. "Capability map", "Review queue" — the current page's own display name, not its route path. */
  pageName?: string;
  modelSummary?: {
    capabilityCount: number;
    systemCount: number;
    openChangeCount: number;
  };
}

/** Context is sent only on the first turn of a conversation (mirrors Des-Studio's own `HelpAssistant.jsx` comment: "so the growing history doesn't re-transmit the same static block every turn"). */
export function buildHelpUserMessage(question: string, context: HelpContext = {}): string {
  const parts: string[] = [];
  if (context.pageName) parts.push(`Current page: ${context.pageName}`);
  if (context.modelSummary) {
    const { capabilityCount, systemCount, openChangeCount } = context.modelSummary;
    parts.push(`Model: ${String(capabilityCount)} capability(ies), ${String(systemCount)} system(s), ${String(openChangeCount)} open change(s).`);
  }
  const contextStr = parts.length > 0 ? `\n\nContext:\n${parts.join('\n')}` : '';
  return `${question}${contextStr}`;
}
