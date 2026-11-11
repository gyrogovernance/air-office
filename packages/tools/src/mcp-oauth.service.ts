import { auth, extractWWWAuthenticateParams, type OAuthClientProvider, type StoredOAuthClientInformation, type StoredOAuthTokens, type OAuthDiscoveryState } from '@modelcontextprotocol/client';
import type { ToolConnection } from '@office/contracts/tool';

export const MCP_OAUTH_CALLBACK_PATH = '/api/v1/tools/oauth/callback';
export type McpOAuthStatus = 'disconnected' | 'authorizing' | 'connected' | 'cancelled' | 'expired' | 'failed';
export type McpOAuthSessionView = { connectionId: string; sessionId: string | null; status: McpOAuthStatus; expiresAt: string | null; error: string | null };
type SavedAuthorization = { version: 1; endpoint: string; redirectUrl: string; clients: Record<string, StoredOAuthClientInformation>; tokens?: StoredOAuthTokens; expiresAt?: number };
type Session = { id: string; connectionId: string; endpoint: string; state: string; verifier: string; expiresAt: number; status: McpOAuthStatus; error: string | null; authorizationUrl?: string; discovery?: OAuthDiscoveryState; controller: AbortController };
type Options = {
  connection(id: string): ToolConnection | undefined;
  redirectUrl: string;
  credentials: { resolve(id: string): Promise<string | null>; store(id: string, secret: string): Promise<void>; forget(id: string): Promise<'removed' | 'absent' | 'failed'>; forgetAll(): Promise<{ removed: number; failed: string[] }> };
  fetchImpl?: typeof fetch;
  now?: () => number;
  sessionLifetimeMs?: number;
};
const secretKey = (id: string) => `mcp-oauth-${Buffer.from(id).toString('base64url')}`;
const failureMessage = 'Browser sign-in could not be completed. Check the server OAuth configuration and try again.';

/** OAuth secrets remain behind the service credential port; public views contain only session progress. */
export function createMcpOAuthService(options: Options) {
  const redirect = new URL(options.redirectUrl);
  if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname) || redirect.pathname !== MCP_OAUTH_CALLBACK_PATH || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error('MCP browser sign-in requires the local service loopback callback.');
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const current = new Map<string, string>();
  const locks = new Map<string, Promise<unknown>>();
  const serialize = <T>(id: string, run: () => Promise<T>): Promise<T> => {
    const operation = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    locks.set(id, operation);
    void operation.finally(() => { if (locks.get(id) === operation) locks.delete(id); }).catch(() => {});
    return operation;
  };
  const connection = (id: string) => {
    const item = options.connection(id);
    if (!item || item.kind !== 'mcp' || !item.endpoint) throw new Error('Choose a saved remote MCP connection.');
    const url = new URL(item.endpoint);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.hash) throw new Error('MCP sign-in requires HTTPS, or a loopback development endpoint.');
    return item as ToolConnection & { endpoint: string };
  };
  const load = async (id: string, endpoint: string): Promise<SavedAuthorization> => {
    const value = await options.credentials.resolve(secretKey(id));
    if (value) {
      try {
        const saved = JSON.parse(value) as SavedAuthorization;
        if (saved.version === 1 && saved.endpoint === endpoint && saved.clients && typeof saved.clients === 'object') return saved;
      } catch { /* An invalid credential record is replaced only after explicit sign-in. */ }
    }
    return { version: 1, endpoint, redirectUrl: redirect.href, clients: {} };
  };
  const expire = (session: Session) => {
    if (session.status === 'authorizing' && now() >= session.expiresAt) {
      session.status = 'expired'; session.verifier = ''; session.controller.abort();
    }
  };
  const active = (session: Session) => {
    expire(session);
    if (session.status !== 'authorizing' || current.get(session.connectionId) !== session.id || options.connection(session.connectionId)?.endpoint !== session.endpoint) throw new Error('This sign-in session is no longer active.');
  };
  const view = (session: Session): McpOAuthSessionView => {
    expire(session);
    return { connectionId: session.connectionId, sessionId: session.id, status: session.status, expiresAt: new Date(session.expiresAt).toISOString(), error: session.error };
  };
  const provider = (id: string, saved: SavedAuthorization, session?: Session): OAuthClientProvider => {
    const persist = async () => {
      if (session) active(session);
      const previous = session ? await options.credentials.resolve(secretKey(id)) : null;
      if (session) active(session);
      await options.credentials.store(secretKey(id), JSON.stringify(saved));
      if (session) {
        try { active(session); }
        catch (error) {
          if (previous === null) {
            if (await options.credentials.forget(secretKey(id)) === 'failed') throw new Error('Cancelled sign-in credentials could not be removed. Disconnect this connection.');
          } else await options.credentials.store(secretKey(id), previous);
          throw error;
        }
      }
    };
    return {
      redirectUrl: redirect.href,
      clientMetadata: { client_name: 'AIR Office', redirect_uris: [redirect.href], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native' },
      state: () => { if (!session) throw new Error('Interactive sign-in is required.'); active(session); return session.state; },
      clientInformation: (ctx) => ctx ? saved.clients[ctx.issuer] : undefined,
      saveClientInformation: async (info, ctx) => { if (!ctx) throw new Error('Missing authorization issuer.'); saved.clients[ctx.issuer] = info; await persist(); },
      tokens: (ctx) => !ctx || saved.tokens?.issuer === ctx.issuer ? saved.tokens : undefined,
      saveTokens: async (tokens) => {
        if (tokens.token_type.toLowerCase() !== 'bearer') throw new Error('This server requires an unsupported token type.');
        saved.tokens = { ...tokens, ...(tokens.refresh_token ? {} : saved.tokens?.refresh_token && saved.tokens.issuer === tokens.issuer ? { refresh_token: saved.tokens.refresh_token } : {}) };
        saved.expiresAt = typeof tokens.expires_in === 'number' ? now() + tokens.expires_in * 1000 : undefined;
        await persist();
      },
      redirectToAuthorization: (url) => { if (!session) throw new Error('Interactive sign-in is required.'); active(session); if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('An HTTPS authorization URL is required.'); session.authorizationUrl = url.href; },
      saveCodeVerifier: (verifier) => { if (!session) throw new Error('Interactive sign-in is required.'); active(session); session.verifier = verifier; },
      codeVerifier: () => { if (!session) throw new Error('Interactive sign-in is required.'); active(session); return session.verifier; },
      saveDiscoveryState: (discovery) => { if (session) { active(session); session.discovery = discovery; } },
      discoveryState: () => session?.discovery,
      invalidateCredentials: async (scope) => {
        if (scope === 'all' || scope === 'tokens') { delete saved.tokens; delete saved.expiresAt; }
        if (scope === 'all' || scope === 'client') saved.clients = {};
        if (session && (scope === 'all' || scope === 'verifier')) session.verifier = '';
        if (session && (scope === 'all' || scope === 'discovery')) session.discovery = undefined;
        await persist();
      }
    };
  };
  const boundedFetch = (session?: Session): typeof fetch => (async (input, init) => {
    const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(session ? [session.controller.signal] : []), ...(init?.signal ? [init.signal] : [])]);
    try {
      const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (target.username || target.password || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)))) throw new Error('Authorization endpoints require HTTPS or loopback.');
      const response = await (options.fetchImpl ?? fetch)(input, { ...init, signal, redirect: 'error' });
      if (!response.ok) {
        // SDK recovery warnings include OAuth error descriptions. Strip remote error bodies
        // before handing failures to the SDK so tokens echoed by a server never reach logs.
        const errorBody = await response.json().catch(() => null) as { error?: unknown } | null;
        const safeErrors = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied', 'unsupported_grant_type', 'invalid_scope', 'invalid_request']);
        const error = typeof errorBody?.error === 'string' && safeErrors.has(errorBody.error) ? errorBody.error : 'server_error';
        return Response.json({ error }, { status: response.status, headers: { 'www-authenticate': response.headers.get('www-authenticate') ?? '' } });
      }
      return response;
    } catch { throw new Error('The authorization request could not be completed.'); }
  }) as typeof fetch;
  const cancelSession = (session: Session) => { if (session.status === 'authorizing') { session.status = 'cancelled'; session.verifier = ''; session.controller.abort(); } };
  return {
    async start(id: string) {
      const item = connection(id);
      const previous = sessions.get(current.get(id) ?? '');
      if (previous) cancelSession(previous);
      // Bound retained terminal views and pending sessions, including abandoned tabs.
      for (const [key, session] of sessions) { expire(session); if (now() > session.expiresAt + 300_000) sessions.delete(key); }
      if (sessions.size >= 100) throw new Error('Too many sign-in sessions. Cancel an existing session or try again later.');
      const session: Session = { id: crypto.randomUUID(), connectionId: id, endpoint: item.endpoint, state: crypto.randomUUID() + crypto.randomUUID(), verifier: '', expiresAt: now() + (options.sessionLifetimeMs ?? 300_000), status: 'authorizing', error: null, controller: new AbortController() };
      sessions.set(session.id, session); current.set(id, session.id);
      return serialize(id, async () => {
        try {
          active(session);
          const saved = await load(id, item.endpoint);
          if (saved.redirectUrl !== redirect.href) { saved.clients = {}; saved.redirectUrl = redirect.href; }
          const probe = await boundedFetch(session)(item.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'AIR Office', version: '0.1.0' } } }) });
          const challenge = extractWWWAuthenticateParams(probe);
          await probe.body?.cancel();
          const result = await auth(provider(id, saved, session), { serverUrl: item.endpoint, forceReauthorization: true, ...(challenge.resourceMetadataUrl ? { resourceMetadataUrl: challenge.resourceMetadataUrl } : {}), ...(challenge.scope ? { scope: challenge.scope } : {}), fetchFn: boundedFetch(session) });
          active(session);
          if (result !== 'REDIRECT' || !session.authorizationUrl) throw new Error('No browser authorization URL was returned.');
          return { ...view(session), authorizationUrl: session.authorizationUrl };
        } catch {
          if (session.status === 'authorizing') { session.status = 'failed'; session.error = failureMessage; }
          session.verifier = '';
          throw new Error(failureMessage);
        }
      });
    },
    async status(id: string, sessionId?: string): Promise<McpOAuthSessionView> {
      const item = connection(id);
      const session = sessions.get(sessionId ?? current.get(id) ?? '');
      if (sessionId && (!session || session.connectionId !== id)) throw new Error('Unknown sign-in session.');
      if (session && session.connectionId === id) return view(session);
      const saved = await load(id, item.endpoint);
      return { connectionId: id, sessionId: null, status: saved.tokens ? 'connected' : 'disconnected', expiresAt: null, error: null };
    },
    async callback(url: URL): Promise<boolean> {
      if (url.pathname !== MCP_OAUTH_CALLBACK_PATH || url.origin !== redirect.origin || url.searchParams.getAll('state').length !== 1) return false;
      const state = url.searchParams.get('state');
      if (!state) return false;
      const session = [...sessions.values()].find((item) => item.state === state);
      if (!session) return false;
      expire(session);
      if (session.status !== 'authorizing') return false;
      // Consume state before any asynchronous token exchange so replays cannot queue.
      session.state = '';
      if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code') || url.searchParams.get('code')!.length > 8192 || url.searchParams.getAll('iss').length > 1) {
        session.status = 'failed'; session.error = 'Sign-in was declined or returned an invalid callback.'; session.verifier = ''; return false;
      }
      return serialize(session.connectionId, async () => {
        try {
          active(session);
          const saved = await load(session.connectionId, session.endpoint);
          const issuer = url.searchParams.get('iss');
          const result = await auth(provider(session.connectionId, saved, session), { serverUrl: session.endpoint, authorizationCode: url.searchParams.get('code')!, ...(issuer ? { iss: issuer } : {}), fetchFn: boundedFetch(session) });
          active(session);
          if (result !== 'AUTHORIZED') throw new Error('Authorization did not complete.');
          session.status = 'connected'; return true;
        } catch {
          if (session.status === 'authorizing') { session.status = 'failed'; session.error = failureMessage; }
          return false;
        } finally { session.verifier = ''; session.discovery = undefined; }
      });
    },
    async cancel(id: string, sessionId: string) {
      connection(id);
      const session = sessions.get(sessionId);
      if (!session || session.connectionId !== id) throw new Error('Unknown sign-in session.');
      cancelSession(session);
      await serialize(id, async () => {});
      return view(session);
    },
    async disconnect(id: string) {
      if (!id || id.length > 300) throw new Error('Invalid connection identifier.');
      for (const session of sessions.values()) if (session.connectionId === id) cancelSession(session);
      await serialize(id, async () => {
        if (await options.credentials.forget(secretKey(id)) === 'failed') throw new Error('The sign-in credentials could not be removed from the system keychain.');
        for (const session of sessions.values()) if (session.connectionId === id) { session.status = 'disconnected'; session.error = null; }
        current.delete(id);
      });
      return { connectionId: id, sessionId: null, status: 'disconnected' as const, expiresAt: null, error: null };
    },
    async clearAll() {
      for (const session of sessions.values()) cancelSession(session);
      await Promise.all([...locks.values()].map((operation) => operation.catch(() => undefined)));
      const result = await options.credentials.forgetAll();
      for (const session of sessions.values()) { session.status = 'disconnected'; session.error = null; }
      current.clear();
      return result;
    },
    async accessToken(id: string, rejectedToken?: string): Promise<string | null> {
      return serialize(id, async () => {
        const item = connection(id);
        const saved = await load(id, item.endpoint);
        if (!saved.tokens) return null;
        if ((!rejectedToken || saved.tokens.access_token !== rejectedToken) && (saved.expiresAt === undefined || now() + 30_000 < saved.expiresAt)) return saved.tokens.access_token;
        if (!saved.tokens.refresh_token) throw new Error('The MCP sign-in has expired. Sign in again.');
        try {
          if (await auth(provider(id, saved), { serverUrl: item.endpoint, fetchFn: boundedFetch() }) !== 'AUTHORIZED') throw new Error('Interactive sign-in is required.');
          return saved.tokens?.access_token ?? null;
        } catch {
          const session = sessions.get(current.get(id) ?? '');
          if (session?.status === 'connected') { session.status = 'failed'; session.error = 'The MCP sign-in has expired. Sign in again.'; }
          throw new Error('The MCP sign-in could not be refreshed. Sign in again.');
        }
      });
    }
  };
}
