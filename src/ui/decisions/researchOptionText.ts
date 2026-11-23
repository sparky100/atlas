import type { WebResearchCandidate } from '../../contracts/webResearch';

export const RESEARCH_OPTION_TITLE_MAX = 120;

/** The option a person gets when they say "use this page". The title says what it is, not who found it. */
export function researchOptionTitle(candidate: Pick<WebResearchCandidate, 'title'>): string {
  const title = `Use ${candidate.title}`.replace(/\s+/g, ' ').trim();
  if (title.length <= RESEARCH_OPTION_TITLE_MAX) return title;
  const cut = title.slice(0, RESEARCH_OPTION_TITLE_MAX - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** The option's own words: what the page is, that it is unreviewed, and where to read it. */
export function researchOptionDescription(candidate: Pick<WebResearchCandidate, 'title' | 'publisher' | 'excerpt' | 'url'>): string {
  const where = candidate.publisher === '' ? candidate.url : candidate.publisher;
  const excerpt = candidate.excerpt === null ? '' : `\n\nWhat the page says: “${candidate.excerpt}”`;
  return `${candidate.title} — ${where}.\n\nUnreviewed web source found by search. Check the page before relying on it.${excerpt}\n${candidate.url}`;
}
