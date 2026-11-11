import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';

export const CHATGPT_SIGNIN_CALLBACK_PATH = '/auth/callback';
export const CHATGPT_SIGNIN_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const CHATGPT_SIGNIN_REQUIRED_SCOPE = 'chatgpt.tokens.use.direct';
const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const authorizeUrl = `${issuer}/api/accounts/authorize`;
const tokenUrl = `${issuer}/api/accounts/oauth/token`;
const jwksUrl = new URL(`${issuer}/.well-known/jwks.json`);

type SavedAccount = {
  version: 1;
  id: string;
  clientId: string;
  hostId: string;
  issuer: string;
  subject: string;
  email: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: string[];
  expiresAt: number;
};
type Session = { id: string; state: string; nonce: string; verifier: string; accountId: string | null; clientId: string | null; subject: string | null; expiresAt: number; status: 'authorizing' | 'connected' | 'failed' | 'cancelled' | 'expired'; error: string | null; authorizationUrl: string; controller: AbortController };
type PublicAccount = { id: string; email: string; active: boolean; connected: boolean; planUsageAvailable: boolean };
type Options = {
  redirectUrl: string;
  credentials: { resolve(id: string): Promise<string | null>; store(id: string, secret: string): Promise<void>; forget(id: string): Promise<'removed' | 'absent' | 'failed'>; forgetAll(): Promise<{ removed: number; failed: string[] }> };
  fetchImpl?: typeof fetch;
  now?: () => number;
  sessionLifetimeMs?: number;
};

const accountKey = (id: string) => `chatgpt-account-${Buffer.from(id).toString('base64url')}`;
const hostKey = 'chatgpt-host-identity';
const accountsKey = 'chatgpt-account-index';
const safeFailure = 'ChatGPT sign-in could not be completed. Try again.';

export function createChatGptSignInService(options: Options) {
  const redirect = new URL(options.redirectUrl);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.pathname !== CHATGPT_SIGNIN_CALLBACK_PATH || redirect.search || redirect.hash || redirect.username || redirect.password) throw new Error('ChatGPT sign-in requires the local 127.0.0.1 callback.');
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const jwks = createRemoteJWKSet(jwksUrl, { [customFetch]: fetchImpl as typeof fetch });
  const sessions = new Map<string, Session>();
  const locks = new Map<string, Promise<unknown>>();
  const accountControllers = new Map<string, AbortController>();
  const accountSignal = (id: string) => {
    let controller = accountControllers.get(id);
    if (!controller) { controller = new AbortController(); accountControllers.set(id, controller); }
    return controller.signal;
  };
  const serialize = <T>(id: string, run: () => Promise<T>): Promise<T> => {
    const operation = (locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
    locks.set(id, operation);
    void operation.finally(() => { if (locks.get(id) === operation) locks.delete(id); }).catch(() => {});
    return operation;
  };
  const load = async (id: string): Promise<SavedAccount | null> => {
    const raw = await options.credentials.resolve(accountKey(id));
    if (!raw) return null;
    try {
      const account = JSON.parse(raw) as SavedAccount;
      return account.version === 1 && account.id === id && account.clientId && account.subject && typeof account.refreshToken === 'string' ? account : null;
    } catch { return null; }
  };
  const accountIds = async () => {
    try {
      const value: unknown = JSON.parse(await options.credentials.resolve(accountsKey) ?? '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length <= 100) : [];
    } catch { return []; }
  };
  const all = async () => Promise.all((await accountIds()).map(async (id) => load(id)));
  const hostIdentity = () => serialize('host', async () => {
    const existing = await options.credentials.resolve(hostKey);
    if (existing && /^urn:uuid:[0-9a-f-]{36}$/iu.test(existing)) return existing;
    const created = `urn:uuid:${crypto.randomUUID()}`;
    await options.credentials.store(hostKey, created);
    return created;
  });
  const boundedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error(safeFailure);
    try { return await fetchImpl(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]), redirect: 'error' }); }
    catch { throw new Error(safeFailure); }
  };
  const parseToken = async (response: Response) => {
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(safeFailure); }
    const value = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!value || typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || (value.id_token !== undefined && typeof value.id_token !== 'string') || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in <= 0) throw new Error(safeFailure);
    return value as { access_token: string; refresh_token: string; id_token?: string; expires_in: number; scope?: string; token_type?: string; client_id?: string };
  };
  const verifyIdentity = async (idToken: string, clientId: string, nonce?: string) => {
    const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: clientId, clockTolerance: 5, ...(nonce ? { nonce } : {}) });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email) throw new Error(safeFailure);
    return { subject: payload.sub, email: payload.email };
  };
  const current = async () => {
    const records = (await all()).filter((item): item is SavedAccount => item !== null);
    const activeId = await options.credentials.resolve('chatgpt-active-account');
    const active = records.find((item) => item.id === activeId && item.refreshToken) ?? records.find((item) => item.refreshToken) ?? null;
    return { accounts: records.map((item) => ({ id: item.id, email: item.email, active: item.id === active?.id, connected: Boolean(item.refreshToken), planUsageAvailable: Boolean(item.refreshToken) && item.scopes.includes(CHATGPT_SIGNIN_REQUIRED_SCOPE) } satisfies PublicAccount)), activeAccountId: active?.id ?? null };
  };
  const view = (session: Session) => {
    if (session.status === 'authorizing' && now() >= session.expiresAt) { session.status = 'expired'; session.verifier = ''; session.controller.abort(); }
    return { sessionId: session.id, status: session.status, expiresAt: new Date(session.expiresAt).toISOString(), error: session.error };
  };

  return {
    async start(accountId?: string) {
      const id = crypto.randomUUID();
      const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const challenge = createHashS256(verifier);
      const hostId = await hostIdentity();
      const previous = accountId ? await load(accountId) : null;
      if (accountId && !previous) throw new Error('Choose a saved ChatGPT account.');
      const params = new URLSearchParams({ response_type: 'code', redirect_uri: redirect.href, scope: CHATGPT_SIGNIN_SCOPE, resource, state, nonce, code_challenge_method: 'S256', code_challenge: challenge, client_id: previous?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: hostId, ...(!previous ? { agent_name_hint: 'AIR Office' } : {}), ...(previous?.idToken ? { id_token_hint: previous.idToken } : {}), ...(previous ? { login_hint: previous.email } : {}) });
      const session: Session = { id, state, nonce, verifier, accountId: previous?.id ?? null, clientId: previous?.clientId ?? null, subject: previous?.subject ?? null, expiresAt: now() + (options.sessionLifetimeMs ?? 300_000), status: 'authorizing', error: null, authorizationUrl: `${authorizeUrl}?${params}`, controller: new AbortController() };
      sessions.set(id, session);
      return { ...view(session), authorizationUrl: session.authorizationUrl };
    },
    status(sessionId?: string) {
      const session = sessionId ? sessions.get(sessionId) : [...sessions.values()].at(-1);
      return session ? view(session) : { sessionId: null, status: 'disconnected', expiresAt: null, error: null };
    },
    async callback(url: URL) {
      if (url.pathname !== CHATGPT_SIGNIN_CALLBACK_PATH || url.origin !== redirect.origin || url.searchParams.getAll('state').length !== 1) return false;
      const session = [...sessions.values()].find((item) => item.state && item.state === url.searchParams.get('state'));
      if (!session || view(session).status !== 'authorizing') return false;
      session.state = '';
      if (url.searchParams.getAll('error').length || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1) { session.status = 'failed'; session.error = safeFailure; session.verifier = ''; return false; }
      return serialize('callback', async () => {
        try {
          const code = url.searchParams.get('code')!;
          const hostId = await hostIdentity();
          const callbackClientId = url.searchParams.get('client_id');
          const issuedClientId = session.clientId ?? callbackClientId;
          if (!issuedClientId || issuedClientId === 'dynamic_agent_client' || (session.clientId && callbackClientId && callbackClientId !== session.clientId)) throw new Error(safeFailure);
          const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: issuedClientId, code, code_verifier: session.verifier, redirect_uri: redirect.href, resource });
          const tokens = await parseToken(await boundedFetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: session.controller.signal }));
          if (tokens.client_id && tokens.client_id !== issuedClientId) throw new Error(safeFailure);
          if (!tokens.id_token) throw new Error(safeFailure);
          const identity = await verifyIdentity(tokens.id_token, issuedClientId, session.nonce);
          if (session.subject && session.subject !== identity.subject) throw new Error(safeFailure);
          if (view(session).status !== 'authorizing' || session.controller.signal.aborted) throw new Error(safeFailure);
          const id = session.accountId ?? crypto.randomUUID();
          const scopes = (tokens.scope ?? '').split(/\s+/u).filter(Boolean);
          const saved: SavedAccount = { version: 1, id, clientId: issuedClientId, hostId, issuer, subject: identity.subject, email: identity.email, idToken: tokens.id_token, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scopes, expiresAt: now() + tokens.expires_in * 1000 };
          await serialize(id, async () => {
            if (view(session).status !== 'authorizing' || session.controller.signal.aborted) throw new Error(safeFailure);
            const previous = session.accountId ? await load(session.accountId) : null;
            if (session.accountId && (!previous || previous.clientId !== issuedClientId || previous.subject !== session.subject)) throw new Error(safeFailure);
            await options.credentials.store(accountKey(id), JSON.stringify(saved));
            await serialize('accounts', async () => {
              await options.credentials.store(accountsKey, JSON.stringify([...new Set([...(await accountIds()), id])]));
              await options.credentials.store('chatgpt-active-account', id);
            });
          });
          session.status = 'connected';
          return true;
        } catch { if (session.status === 'authorizing') { session.status = 'failed'; session.error = safeFailure; } return false; }
        finally { session.verifier = ''; }
      });
    },
    async cancel(sessionId: string) { const session = sessions.get(sessionId); if (!session) throw new Error('Unknown ChatGPT sign-in session.'); if (session.status === 'authorizing') { session.status = 'cancelled'; session.verifier = ''; session.controller.abort(); } return view(session); },
    accounts: current,
    accountSignal,
    async select(id: string) { return serialize(id, async () => { const account = await load(id); if (!account?.refreshToken) throw new Error('Reconnect this ChatGPT account before using it.'); await serialize('accounts', () => options.credentials.store('chatgpt-active-account', id)); return current(); }); },
    async accessToken(accountId?: string) {
      const selectedId = accountId ?? (await current()).activeAccountId;
      if (!selectedId) return null;
      return serialize(selectedId, async () => {
        const account = await load(selectedId);
        if (!account?.refreshToken) return null;
        if (account.expiresAt > now() + 30_000) {
          if (!account.scopes.includes(CHATGPT_SIGNIN_REQUIRED_SCOPE)) throw new Error('ChatGPT plan usage is not enabled for this account. Sign in again to grant access.');
          return account.accessToken;
        }
        const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource });
        try {
          const tokens = await parseToken(await boundedFetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }));
          if (tokens.id_token) {
            const identity = await verifyIdentity(tokens.id_token, account.clientId);
            if (identity.subject !== account.subject) throw new Error(safeFailure);
          }
          account.accessToken = tokens.access_token; account.refreshToken = tokens.refresh_token; account.idToken = tokens.id_token ?? account.idToken; account.expiresAt = now() + tokens.expires_in * 1000;
          account.scopes = (tokens.scope ?? account.scopes.join(' ')).split(/\s+/u).filter(Boolean);
          await options.credentials.store(accountKey(account.id), JSON.stringify(account));
          if (!account.scopes.includes(CHATGPT_SIGNIN_REQUIRED_SCOPE)) throw new Error('ChatGPT plan usage is not enabled for this account. Sign in again to grant access.');
          return account.accessToken;
        } catch { throw new Error('The ChatGPT sign-in expired or could not be refreshed. Sign in again.'); }
      });
    },
    async disconnect(id?: string) {
      const target = id ?? (await current()).activeAccountId;
      if (!target) return { ...await current(), revocationConfirmed: true };
      accountControllers.get(target)?.abort();
      accountControllers.delete(target);
      let revocationConfirmed = false;
      await serialize(target, async () => {
        const account = await load(target);
        if (account) {
          const body = new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId });
          const response = await boundedFetch(`${issuer}/api/accounts/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).catch(() => null);
          revocationConfirmed = response?.status === 200;
          await response?.body?.cancel().catch(() => undefined);
        }
        if (account) await options.credentials.store(accountKey(target), JSON.stringify({ ...account, idToken: '', accessToken: '', refreshToken: '', scopes: [], expiresAt: 0 } satisfies SavedAccount));
        await serialize('accounts', async () => {
          const active = await options.credentials.resolve('chatgpt-active-account');
          if (active === target) await options.credentials.forget('chatgpt-active-account');
        });
      });
      return { ...await current(), revocationConfirmed };
    },
    async clearAll() {
      for (const controller of accountControllers.values()) controller.abort();
      accountControllers.clear();
      for (const session of sessions.values()) if (session.status === 'authorizing') { session.status = 'cancelled'; session.verifier = ''; session.controller.abort(); }
      await Promise.all([...locks.values()].map((operation) => operation.catch(() => undefined)));
      const ids = await accountIds();
      const credentialIds = [...ids.map((id) => accountKey(id)), accountsKey, hostKey, 'chatgpt-active-account'];
      const results = await Promise.all(credentialIds.map((id) => options.credentials.forget(id)));
      return { removed: results.filter((result) => result === 'removed').length, failed: results.flatMap((result, index) => result === 'failed' ? [index < ids.length ? accountKey(ids[index]!) : [accountsKey, hostKey, 'chatgpt-active-account'][index - ids.length]!] : []) };
    }
  };
}

function createHashS256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
