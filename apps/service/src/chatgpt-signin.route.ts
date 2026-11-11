import { CHATGPT_SIGNIN_CALLBACK_PATH, type createChatGptSignInService } from '@office/providers/service';

type SignInService = ReturnType<typeof createChatGptSignInService>;
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export function createChatGptSignInRoutes(service: SignInService) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === CHATGPT_SIGNIN_CALLBACK_PATH && request.method === 'GET') {
      const success = await service.callback(url).catch(() => false);
      return new Response(success ? 'ChatGPT sign-in completed. You can close this tab and return to AIR Office.' : 'ChatGPT sign-in did not complete or the link expired. Return to AIR Office and try again.', { status: success ? 200 : 400, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname === '/api/v1/cloud/chatgpt/status' && request.method === 'GET') return json({ ...service.status(url.searchParams.get('sessionId') ?? undefined), ...await service.accounts() });
    if (url.pathname === '/api/v1/cloud/chatgpt/accounts' && request.method === 'GET') return json(await service.accounts());
    if (url.pathname === '/api/v1/cloud/chatgpt/sign-in' && request.method === 'POST') {
      const body: unknown = await request.json().catch(() => ({}));
      if (!body || typeof body !== 'object' || Array.isArray(body) || ('accountId' in body && (typeof body.accountId !== 'string' || !body.accountId || body.accountId.length > 100))) return json({ error: 'Choose a valid ChatGPT account.' }, 400);
      try { return json(await service.start('accountId' in body && typeof body.accountId === 'string' ? body.accountId : undefined), 201); } catch { return json({ error: 'ChatGPT sign-in could not be started.' }, 400); }
    }
    if (url.pathname === '/api/v1/cloud/chatgpt/cancel' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { sessionId?: unknown } | null;
      if (typeof body?.sessionId !== 'string' || body.sessionId.length > 100) return json({ error: 'Choose a sign-in session to cancel.' }, 400);
      try { return json(await service.cancel(body.sessionId)); } catch { return json({ error: 'The sign-in session could not be cancelled.' }, 400); }
    }
    if (url.pathname === '/api/v1/cloud/chatgpt/select' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
      if (typeof body?.accountId !== 'string' || body.accountId.length > 100) return json({ error: 'Choose a saved account.' }, 400);
      try { return json(await service.select(body.accountId)); } catch { return json({ error: 'The saved account could not be selected.' }, 400); }
    }
    const disconnect = url.pathname.match(/^\/api\/v1\/cloud\/chatgpt\/accounts\/([^/]+)$/u);
    if (disconnect && request.method === 'DELETE') {
      try { return json(await service.disconnect(decodeURIComponent(disconnect[1]!))); } catch { return json({ error: 'The ChatGPT account could not be disconnected.' }, 400); }
    }
    if (url.pathname === '/api/v1/cloud/chatgpt/account' && request.method === 'DELETE') {
      try { return json(await service.disconnect()); } catch { return json({ error: 'The ChatGPT account could not be disconnected.' }, 400); }
    }
    return new Response('Not found', { status: 404, headers });
  };
}
