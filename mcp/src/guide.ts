/** ADR-029 §1: the text `atlas_get_guide` returns. No model data. */
export const ATLAS_GUIDE = `How Atlas is organised
- Atlas models an organisation as elements (capabilities, value streams, systems, actors, data, projects and so on) joined by relationships (a system supports a capability, an actor owns a system, one system integrates with another).
- Capabilities say what the organisation does; systems are the applications and services that support them; owners are the people or teams responsible.
- Work in progress lives in "changes": proposed edits that are not live yet. Decisions and projects are recorded beside the model.

Which tool answers which question
- atlas_list_models: which models you can see. Call this first.
- atlas_search_elements: find an element by name or alias.
- atlas_get_element: everything about one element (attributes, owner, links).
- atlas_list_relationships: what one element is connected to.
- atlas_find_elements: filter by type, lifecycle, owner or attribute value.
- atlas_list_saved_reports / atlas_run_saved_report: the reports people saved, and their rows.
- atlas_list_health_findings: data-quality and risk findings.
- atlas_portfolio_signals: the application portfolio at a glance.
- atlas_list_changes / atlas_change_impact: proposed changes and what each would touch.
- atlas_list_decisions / atlas_list_projects: the decision and project records.

Reading a change instead of the live model
- Every tool below atlas_list_models takes an optional "change" (a changeId from atlas_list_changes). The result then shows the model as that change would leave it. Without it you read the live model.

Rules of thumb
- Every result says which model and state it was read from (the "stamp"). Say so when you quote it.
- Results are capped (50 rows, long text clipped). When a result says it was truncated, narrow the lookup rather than guessing at the rest.
- Cite an element by name. Do not invent elements, ids or numbers that no tool returned.
- Everything here is read-only. To change the model, use Atlas itself.
`;
