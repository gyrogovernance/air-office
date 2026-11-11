/**
 * Proxies AIR-Craft.md for Craft. The desktop webview CSP only allows
 * loopback `connect-src`, so the renderer must not fetch GitHub raw URLs.
 */
export function createCraftCatalogRoutes() {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/craft/air-craft-md' || request.method !== 'GET') return null;

    try {
      const upstream = await fetch('https://raw.githubusercontent.com/gyrogovernance/air-craft/main/AIR-Craft.md', {
        signal: request.signal,
        headers: {
          accept: 'text/plain, text/markdown, */*',
          'user-agent': 'AIR-Office/0.1 (local Craft catalogue; https://github.com/gyrogovernance/air-office)',
        },
      });
      if (!upstream.ok) {
        return Response.json({ error: 'The AIR-Craft catalogue is unavailable right now.' }, { status: 502 });
      }
      const markdown = await upstream.text();
      return Response.json({ markdown });
    } catch (reason) {
      if (request.signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) {
        return new Response(null, { status: 499 });
      }
      return Response.json({ error: 'The AIR-Craft catalogue could not be reached.' }, { status: 502 });
    }
  };
}
