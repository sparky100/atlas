/**
 * The one HTTP shape connectors use, so a fetcher is tested against canned
 * responses with no network. The real one is `fetch`, wrapped.
 */
export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  text: () => Promise<string>;
}

export type Http = (url: string, init?: HttpRequest) => Promise<HttpResponse>;

/** What a connector reports when it cannot finish. `message` is plain English, shown to a person as it is. */
export class ConnectorError extends Error {
  constructor(
    readonly code: 'sign_in_failed' | 'no_access' | 'provider' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const realHttp: Http = async (url, init) => {
  const response = await fetch(url, { method: init?.method ?? 'GET', ...(init?.headers ? { headers: init.headers } : {}), ...(init?.body !== undefined ? { body: init.body } : {}) });
  return { status: response.status, text: () => response.text() };
};
