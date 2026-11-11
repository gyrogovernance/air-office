import { createWebPageLoader, WebSearchSettingsError } from '@office/providers/service';
import type { WebSearchSettings } from '@office/providers/service';

/**
 * HTTP translation only. The stored endpoint and the provider it produces
 * belong to the providers module. Query and fetch serve product surfaces such
 * as Today. Chat web_search uses the same provider; page opens stay on Copilot web_fetch.
 */
export function createWebSearchSettingsRoutes(settings: WebSearchSettings) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    try {
      if (url.pathname === '/api/v1/web-search') {
        if (request.method === 'GET') return Response.json(settings.state());
        if (request.method === 'PUT') {
          const body = await request.json().catch(() => null);
          return Response.json(await settings.save(body));
        }
        return null;
      }
      if (url.pathname === '/api/v1/web-search/check' && request.method === 'POST') {
        return Response.json(await settings.check());
      }
      if (url.pathname === '/api/v1/web-search/query' && request.method === 'POST') {
        const body = await request.json().catch(() => null) as { query?: unknown; limit?: unknown; category?: unknown } | null;
        if (!body || typeof body.query !== 'string' || !body.query.trim() || body.query.length > 400) {
          return Response.json({ error: 'Provide a search query.' }, { status: 400 });
        }
        const provider = settings.provider();
        if (!provider) return Response.json({ error: 'Web search is switched off for this workspace. Turn it on in Settings to search the web.' }, { status: 503 });
        const limit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? Math.min(Math.max(Math.trunc(body.limit), 1), 10) : undefined;
        const result = await provider.search(body.query, {
          ...(limit !== undefined ? { limit } : {}),
          ...(body.category === 'news' ? { category: 'news' as const } : {})
        }, request.signal);
        return Response.json(result);
      }
      if (url.pathname === '/api/v1/web-search/fetch' && request.method === 'POST') {
        const body = await request.json().catch(() => null) as { url?: unknown } | null;
        if (!body || typeof body.url !== 'string' || body.url.length < 8 || body.url.length > 2000) {
          return Response.json({ error: 'Provide an http or https URL.' }, { status: 400 });
        }
        if (!settings.state().enabled) return Response.json({ error: 'Web search is switched off.' }, { status: 503 });
        const options = settings.state();
        const page = await createWebPageLoader({ timeoutMs: options.timeoutMs, trustProxyEnvironment: options.trustProxyEnvironment }).fetch(body.url, request.signal);
        return Response.json(page);
      }
      return null;
    } catch (error) {
      if (error instanceof WebSearchSettingsError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.code === 'invalid' ? 400 : 502 });
      }
      if (url.pathname === '/api/v1/web-search/query' || url.pathname === '/api/v1/web-search/fetch' || url.pathname === '/api/v1/web-search/check') {
        return Response.json({ error: error instanceof Error ? error.message : 'Web search failed.' }, { status: 502 });
      }
      return Response.json({ error: 'The search setting could not be saved.' }, { status: 500 });
    }
  };
}
