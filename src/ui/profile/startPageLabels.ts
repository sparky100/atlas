import type { StartPage } from '../../contracts/userPreferences';

/** Plain-English names for the start pages, shared by the profile setting and the "Make this my start page" buttons. */
export const START_PAGE_LABELS: Record<StartPage, string> = {
  home: 'Home',
  'capability-map': 'Capability map',
  landscape: 'Landscape',
};

/** The path under a model for each start page. */
export const START_PAGE_PATHS: Record<StartPage, string> = {
  home: '',
  'capability-map': '/capability-map',
  landscape: '/landscape',
};
