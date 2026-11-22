import { atlasVocabularyForAi } from '../../src/tools/vocabularyForAi';

/**
 * ADR-029 §1: the text `atlas_get_guide` returns. No model data. The words
 * block is shared with Ask Atlas (`src/tools/vocabularyForAi.ts`), so both
 * explain Atlas the way the app and `docs/VOCABULARY.md` do; a test checks
 * that every tool is named here.
 */
export const ATLAS_GUIDE = `How Atlas is organised
- Atlas models an organisation as elements (capabilities, systems, modules, actors and value streams) joined by relationships. There are six relationship types, explained below.
- Capabilities say what the organisation does; systems are the applications and services that support them; actors are the people, teams and organisations who own or use them.
- Work in progress lives in "changes": proposed edits that are not live yet. Goals, principles, decisions and projects are recorded beside the model, not inside it.

${atlasVocabularyForAi()}

Which tool answers which question
- atlas_list_models: which models you can see. Call this first.
- atlas_search_elements: find an element by name or alias.
- atlas_get_element: everything about one element (attributes, owner, planned action, whether it is planned, active or retired today).
- atlas_list_relationships: what one element is connected to, with the meaning of each link as above.
- atlas_find_elements: filter by type, lifecycle, owner or attribute value (the planned action field is named "disposition" here).
- atlas_find_catalogue_products: reviewed products for a capability, with dated vendor claims.
- atlas_list_saved_reports / atlas_run_saved_report: the reports people saved, and their rows.
- atlas_list_health_findings: data-quality and risk findings.
- atlas_portfolio_signals: the application portfolio at a glance (run cost band against fit, criticality and planned action).
- atlas_list_changes / atlas_change_impact: proposed changes and what each would touch.
- atlas_list_decisions / atlas_list_projects: the decision and project records. A decision is proposed, accepted, cancelled or superseded.
- atlas_list_goals: the goals the organisation is working towards, and the capabilities that serve each (why a capability matters).
- atlas_list_principles: the principles decisions are checked against, and which decisions follow or depart from each.

Reading a change instead of the live model
- Every tool below atlas_list_models takes an optional "change" (a changeId from atlas_list_changes). The result then shows the model as that change would leave it. Without it you read the live model.

Rules of thumb
- Every result says which model and state it was read from (the "stamp"). Say so when you quote it.
- Answer for today unless asked otherwise. The portfolio and relationship tools leave out planned and retired systems and tell you how many; pass includePlannedAndRetired when the question is about what is planned or what has ended.
- Results are capped (50 rows, long text clipped). When a result says it was truncated, narrow the lookup rather than guessing at the rest.
- Cite an element by name. Do not invent elements, ids or numbers that no tool returned. Run cost is a band, never a figure: do not add bands up.
- Everything here is read-only. To change the model, use Atlas itself.
- It works only while an owner has switched on Ask Atlas for the organisation, and only for people who sign in to Atlas with an email and password.
`;
