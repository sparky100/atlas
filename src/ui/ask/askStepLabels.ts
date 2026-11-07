/** Plain-language names for the lookups, shown in the "what I looked at" list. */
const LABELS: Record<string, string> = {
  search_elements: 'Searched for elements',
  get_element: 'Read an element',
  list_relationships: 'Listed relationships',
  find_elements: 'Filtered elements',
  list_saved_reports: 'Listed saved reports',
  run_saved_report: 'Ran a saved report',
  list_health_findings: 'Checked data-quality findings',
  portfolio_signals: 'Read portfolio signals',
};

export function askStepLabel(name: string): string {
  return LABELS[name] ?? 'Looked something up';
}
