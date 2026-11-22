/**
 * D4 guarded Researcher: the wire shape between the research-agent edge
 * function and the Researcher UI. A candidate is a public page Anthropic's
 * search returned, with the provider's title and the sentence it cited. The
 * person still has to read it and say what it supports before anything is
 * saved to a decision option.
 */
export interface WebResearchCandidate {
  /** Public HTTPS URL, as the provider returned it. */
  url: string;
  /** The provider's page title; never a title the model wrote itself. */
  title: string;
  /** Host name, for a compact "where this came from" line. */
  publisher: string;
  /** The sentence the provider says it used, when it gave one. */
  excerpt: string | null;
  /** When this search ran (the same for every candidate in one response). */
  retrievedAt: string;
}

export interface WebResearchSearch {
  /** The exact query the person approved, sent unchanged. */
  query: string;
  candidates: WebResearchCandidate[];
  searchedAt: string;
  /** Billed provider-side searches actually made, from the proxy, not the model's claim. */
  requests: number;
}

export type WebResearchResponse =
  | ({ status: 'ok' } & WebResearchSearch)
  | { status: 'error'; message: string };
