import { expect, test } from 'bun:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { exportJWK, SignJWT } from '../../../packages/providers/node_modules/jose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatGptSignInService, CHATGPT_SIGNIN_CALLBACK_PATH, CHATGPT_SIGNIN_REQUIRED_SCOPE } from '../../../packages/providers/src/chatgpt-signin.service';
import { createProtectedCredentialStore } from '../../../packages/providers/src/protected-credential.adapter';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = await exportJWK(publicKey);
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
publicJwk.kid = 'fixture';

async function idToken(input: { clientId: string; nonce: string; subject: string; email: string }) {
  return new SignJWT({ email: input.email, nonce: input.nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer(issuer)
    .setAudience(input.clientId)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'air-office-chatgpt-'));
  const credentials = createProtectedCredentialStore({ directory: join(root, 'creds') });
  let clock = 1_000_000;
  const tokens = new Map<string, { access: string; refresh: string; id: string; clientId: string; scope: string }>();
  const fetchImpl = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.href === `${issuer}/.well-known/jwks.json`) return Response.json({ keys: [publicJwk] });
    if (url.href === `${issuer}/api/accounts/oauth/token`) {
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (body.get('grant_type') === 'authorization_code') {
        const code = body.get('code') ?? '';
        const issued = tokens.get(code);
        if (!issued) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        expect(body.get('client_id')).toBe(issued.clientId);
        expect(body.get('redirect_uri')).toBe(`http://127.0.0.1:4317${CHATGPT_SIGNIN_CALLBACK_PATH}`);
        expect(body.get('resource')).toBe(resource);
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBeTruthy();
        return Response.json({
          access_token: issued.access,
          refresh_token: issued.refresh,
          id_token: issued.id,
          expires_in: 3600,
          scope: issued.scope,
          token_type: 'Bearer',
          client_id: issued.clientId
        });
      }
      return Response.json({ error: 'unsupported' }, { status: 400 });
    }
    if (url.href === `${issuer}/api/accounts/oauth/revoke`) return new Response(null, { status: 200 });
    return new Response('missing', { status: 404 });
  }, { preconnect: fetch.preconnect });
  const service = createChatGptSignInService({
    redirectUrl: `http://127.0.0.1:4317${CHATGPT_SIGNIN_CALLBACK_PATH}`,
    credentials,
    fetchImpl,
    now: () => clock
  });
  return {
    service,
    credentials,
    root,
    advance: (ms: number) => { clock += ms; },
    async complete(session: { authorizationUrl: string }) {
      const authorization = new URL(session.authorizationUrl);
      const clientId = 'oaiapp_fixture_client';
      const nonce = authorization.searchParams.get('nonce')!;
      const code = randomUUID();
      const id = await idToken({ clientId, nonce, subject: 'subject-1', email: 'user@example.com' });
      tokens.set(code, {
        access: `access-${'x'.repeat(800)}`,
        refresh: `refresh-${'y'.repeat(800)}`,
        id,
        clientId,
        scope: `openid profile email offline_access resource.invoke ${CHATGPT_SIGNIN_REQUIRED_SCOPE}`
      });
      const callback = new URL(`http://127.0.0.1:4317${CHATGPT_SIGNIN_CALLBACK_PATH}`);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('client_id', clientId);
      callback.searchParams.set('scope', `openid profile email offline_access resource.invoke ${CHATGPT_SIGNIN_REQUIRED_SCOPE}`);
      return callback;
    },
    close: () => rmSync(root, { recursive: true, force: true })
  };
}

test('ChatGPT sign-in stores oversized tokens in the protected private store and exposes only account identity', async () => {
  const f = fixture();
  try {
    const started = await f.service.start();
    expect(started.status).toBe('authorizing');
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.searchParams.get('client_id')).toBe('dynamic_agent_client');
    expect(authorization.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:4317${CHATGPT_SIGNIN_CALLBACK_PATH}`);
    expect(authorization.hostname).toBe('auth.openai.com');
    const callback = await f.complete(started);
    expect(await f.service.callback(callback)).toBe(true);
    expect(await f.service.callback(callback)).toBe(false);
    const accounts = await f.service.accounts();
    expect(accounts.accounts).toHaveLength(1);
    expect(accounts.accounts[0]).toMatchObject({ email: 'user@example.com', connected: true, planUsageAvailable: true, active: true });
    expect(JSON.stringify(accounts)).not.toContain('access-');
    expect(JSON.stringify(accounts)).not.toContain('refresh-');
    const token = await f.service.accessToken();
    expect(token?.startsWith('access-')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify({ access: token }), 'utf16le')).toBeGreaterThan(1000);
  } finally {
    f.close();
  }
});

test('ChatGPT callback rejects origin and state mismatches without writing credentials', async () => {
  const f = fixture();
  try {
    const started = await f.service.start();
    const good = await f.complete(started);
    const wrongOrigin = new URL(good.href);
    wrongOrigin.host = '127.0.0.1:9999';
    expect(await f.service.callback(wrongOrigin)).toBe(false);
    const wrongState = new URL(good.href);
    wrongState.searchParams.set('state', 'tampered');
    expect(await f.service.callback(wrongState)).toBe(false);
    expect((await f.service.accounts()).accounts).toEqual([]);
    expect(await f.credentials.resolve('chatgpt-host-identity')).not.toBeNull();
  } finally {
    f.close();
  }
});
