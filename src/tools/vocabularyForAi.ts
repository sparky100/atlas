/**
 * The words Atlas uses, as the AI sees them: Ask Atlas's prompt and the MCP
 * guide both include this block, so they explain the model in the same terms
 * as the app and as `docs/VOCABULARY.md` (the reviewed master; the test in
 * `src/ui/help/vocabulary.test.ts` checks the two agree). Option names are
 * read from the contracts, never retyped. Pure; no I/O.
 *
 * Why a constant and not an import of the markdown: this module is bundled
 * into an edge function and the MCP server, neither of which can import a
 * `.md` file the way Vite does.
 */
import { ANNUAL_RUN_COST_BANDS, DISPOSITION_LEVELS } from '../contracts/attributeSchema';
import { DISPOSITION_NOT_ASSESSED_LABEL } from '../engine/elementRead/disposition';

export function atlasVocabularyForAi(options: { runCost?: 'share' | 'exclude' } = {}): string {
  const plannedActions = DISPOSITION_LEVELS.map((l) => `${l.label} (stored as "${l.key}")`).join(', ');
  const costBands = ANNUAL_RUN_COST_BANDS.map((b) => b.label).join(', ');
  return [
    'What things are',
    '- Capability: something the organisation does, whatever supports it. Capabilities nest.',
    '- System: a named piece of software or service. A module is something inside a platform; an interface is a module of an integration platform.',
    '- Actor: a person, team or organisation. Value stream: how an outcome is delivered, as stages.',
    '- There are no elements for data, services, processes, goals or projects. Goals, projects, decisions, changes and principles are records kept beside the model.',
    '',
    'The six relationship types',
    '- uses: "A relies on B" (from B\'s side, "used by"). Says nothing about data moving. System or module to system or module, or a person, team or organisation to a system or module.',
    '- flows_to: "A sends data to B" (from B\'s side, "receives from"). Between systems or modules only, never from a person or team. It can go via an integration platform or one of its interfaces.',
    '- Uses and flows_to are different: "does A need B?" is uses; "does data travel from A to B?" is flows_to. The same pair can have one of each.',
    '- supports: a system or module supports a capability, with a fit rating (excellent, good, adequate, poor). One supports link per system can be primary.',
    '- owns: a person, team or organisation owns a capability, system or module as its business, technical or service owner. It is a recorded fact and has nothing to do with someone\'s role in Atlas.',
    '- replaces: one system or module replaces another. enables: a capability enables a value-stream stage.',
    '',
    'Values',
    `- Planned action (also called TIME; the field is named "disposition" in filters): ${plannedActions}. Unset reads "${DISPOSITION_NOT_ASSESSED_LABEL}".`,
    ...(options.runCost === 'exclude' ? ['- Run cost is not available to you: this organisation has chosen not to share it. If asked about cost, say so; never estimate it.'] : [`- Run cost is a band, never a figure, so it is never added up: ${costBands}.`]),
    '- Lifecycle is planned, active, retiring or retired.',
    '',
    'Today\'s picture',
    '- A system or module is planned until its Introduced date, active from then, and retired from its Planned end date. A relationship counts only when both ends are active.',
    '- Unless asked otherwise, answer for today: planned and retired systems are left out, as in the Portfolio, the landscape and the capability map. Say when you have left some out, and include them when the question is about what is planned or what has ended.',
  ].join('\n');
}
