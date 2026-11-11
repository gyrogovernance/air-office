import { MCP_OAUTH_CALLBACK_PATH, type createMcpOAuthService } from '@office/tools/oauth';

type OAuthService = ReturnType<typeof createMcpOAuthService>;
/** Mount callback before bearer authorization, and every connection route after it. */
export function createMcpOAuthRoutes(oauth: OAuthService) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' };
    if (url.pathname === MCP_OAUTH_CALLBACK_PATH && request.method === 'GET') {
      const success = await oauth.callback(url).catch(() => false);
      return new Response(success ? 'Sign-in completed. You can close this tab and return to AIR Office.' : 'Sign-in did not complete or this link has expired. Return to AIR Office and try again.', { status: success ? 200 : 400, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }
    const match = url.pathname.match(/^\/api\/v1\/tools\/connections\/([^/]+)\/oauth\/(start|status|cancel|disconnect)$/);
    if (!match) return new Response('Not found', { status: 404, headers });
    const action = match[2];
    if (request.method !== (action === 'status' ? 'GET' : 'POST')) return new Response('Method not allowed', { status: 405, headers });
    try {
      const id = decodeURIComponent(match[1]!);
      if (!id || id.length > 300) throw new Error('Invalid connection identifier.');
      if (action === 'start') return Response.json(await oauth.start(id), { status: 201, headers });
      if (action === 'status') return Response.json(await oauth.status(id, url.searchParams.get('sessionId') ?? undefined), { headers });
      if (action === 'disconnect') return Response.json(await oauth.disconnect(id), { headers });
      const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
      if (typeof body?.sessionId !== 'string' || body.sessionId.length > 100) return Response.json({ error: 'Choose a sign-in session to cancel.' }, { status: 400, headers });
      return Response.json(await oauth.cancel(id, body.sessionId), { headers });
    } catch {
      return Response.json({ error: 'The sign-in operation could not be completed. Check the connection and try again.' }, { status: 400, headers });
    }
  };
}
