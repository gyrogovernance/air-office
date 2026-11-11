/**
 * Proxies Wikipedia’s featured feed for Today. The desktop webview CSP only
 * allows loopback `connect-src`, so the renderer must not fetch Wikimedia
 * directly — web search already works because it goes through this service.
 */
export function createTodayWikipediaRoutes() {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/today/wikipedia-featured' || request.method !== 'GET') return null;

    const now = new Date();
    const fallback = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
    const path = url.searchParams.get('date')?.trim() || fallback;
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(path)) {
      return Response.json({ error: 'Provide a date as YYYY/MM/DD.' }, { status: 400 });
    }

    try {
      const upstream = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${path}`, {
        signal: request.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'AIR-Office/0.1 (local Today edition; https://github.com/gyrogovernance/air-office)',
        },
      });
      if (!upstream.ok) {
        return Response.json({ error: 'Wikipedia’s curated digest is unavailable right now.' }, { status: 502 });
      }
      const feed: unknown = await upstream.json();
      return Response.json(feed);
    } catch (reason) {
      if (request.signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) {
        return new Response(null, { status: 499 });
      }
      return Response.json({ error: 'Wikipedia’s curated digest could not be reached.' }, { status: 502 });
    }
  };
}
