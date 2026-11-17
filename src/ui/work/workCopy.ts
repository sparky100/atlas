/** The one-line explanation of each kind of work. Every Work page and the Work overview read these, so the three words are always explained the same way. */
export const WORK_COPY = {
  decision: 'Compare options and record which way you go.',
  change: 'Edit the model, then get the edit reviewed before it goes in.',
  project: 'Group the related decisions and changes for one piece of work.',
  review: 'Changes and imports that someone needs to check before they go in.',
} as const;

/** The one-line explanation of each part of Direction: where the organisation is heading and the rules it agreed to follow. */
export const DIRECTION_COPY = {
  goal: 'What the organisation is trying to achieve, and the capabilities that serve each goal.',
  principle: 'The rules your team agrees decisions will be checked against.',
} as const;
