import type { WebSearchProvider, WebSearchResponse, WebSearchResult } from '@office/contracts/capability';

export interface EndpointSearchProviderOptions {
  id?: string;
  /** Endpoint URL. The adapter sends `q`, `format=json`, and `pageno` query parameters and expects a SearxNG-shaped `{ results: [...] }` JSON body. */
  endpoint: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Milliseconds before the request is abandoned. A search that never answers must not hold a chat run open. */
  timeoutMs?: number;
  /** Whether TLS certificates are verified. Off only for a self-signed local service. */
  verifySsl?: boolean;
  /** How many requests may run at once. */
  maxConcurrentRequests?: number;
  /** Whether the search service's own web loader is bypassed for a result it cannot fetch. */
  bypassWebLoader?: boolean;
  /** Whether proxy environment variables are honoured when reaching the service. */
  trustProxyEnvironment?: boolean;
}

function asResult(value: unknown): WebSearchResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== 'string') return null;
  let url: string;
  try { url = new URL(record.url).toString(); } catch { return null; }
  if (!/^https?:$/.test(new URL(url).protocol)) return null;
  return { title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : url, url, snippet: typeof record.content === 'string' ? record.content : '' };
}

/**
 * Pluggable web research engine behind one JSON endpoint contract. The caller
 * depends on the WebSearchProvider port, so a different engine (another search
 * service or a local index) is a second factory, not a change to the tool.
 */
export function createEndpointSearchProvider(options: EndpointSearchProviderOptions): WebSearchProvider {
  if (!/^https?:\/\//i.test(options.endpoint)) throw new Error('A search provider requires an http(s) endpoint.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const id = options.id ?? 'endpoint-search';
  const timeoutMs = Math.min(Math.max(Math.trunc(options.timeoutMs ?? 15_000), 1_000), 120_000);
  const maxConcurrentRequests = Math.min(Math.max(Math.trunc(options.maxConcurrentRequests ?? 1), 1), 8);
  const verifySsl = options.verifySsl !== false;
  // The concurrency limit is enforced here rather than by the caller, so every
  // path into the provider — a chat tool, a settings check — respects it.
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = async (): Promise<() => void> => {
    if (active < maxConcurrentRequests) {
      active += 1;
      return () => { active -= 1; waiting.shift()?.(); };
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    return () => { active -= 1; waiting.shift()?.(); };
  };
  return {
    id,
    async search(query: string, opts: { limit?: number; category?: 'news' } = {}, signal?: AbortSignal): Promise<WebSearchResponse> {
      const trimmed = query.trim();
      if (!trimmed) throw new Error('A search query is required.');
      const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 5), 1), 10);
      const url = new URL(options.endpoint);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('format', 'json');
      url.searchParams.set('pageno', '1');
      if (opts.category === 'news') {
        url.searchParams.set('categories', 'news');
        url.searchParams.set('time_range', 'day');
      }
      // The request carries its own deadline so a search service that never
      // answers ends the tool call instead of holding the chat run open.
      const deadline = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const release = await acquire();
      let response: Response;
      try {
        // A self-signed certificate is refused unless the user turned
        // verification off for their own local service.
        response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: combined, ...(verifySsl ? {} : { tls: { rejectUnauthorized: false } }) } as RequestInit);
      } catch (reason) {
        if (deadline.aborted) throw new Error(`The search provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`);
        throw reason;
      } finally {
        release();
      }
      if (!response.ok) throw new Error(`The search provider responded with HTTP ${response.status}.`);
      const body: unknown = await response.json().catch(() => null);
      const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).results : undefined;
      if (!Array.isArray(raw)) throw new Error('The search provider returned an unreadable response.');
      const results = raw.map(asResult).filter((item): item is WebSearchResult => item !== null).slice(0, limit);
      return { query: trimmed, provider: id, searchedAt: new Date().toISOString(), results };
    }
  };
}
