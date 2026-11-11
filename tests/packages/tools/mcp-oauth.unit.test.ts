import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMcpOAuthService, MCP_OAUTH_CALLBACK_PATH } from '../../../packages/tools/src/mcp-oauth.service';
import { createRemoteToolConnector } from '../../../packages/tools/src/remote-tool-connector.adapter';
import type { ToolConnection } from '@office/contracts/tool';

function fixture() {
  let clock = 100_000;
  let refreshes = 0;
  let exchanges = 0;
  let challenge = '';
  let redirectUri = '';
  let rejectRefresh = false;
  const secrets = new Map<string, string>();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    const base = url.origin;
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: `${base}/mcp`, authorization_servers: [base] });
    if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] });
    if (url.pathname === '/register') {
      const metadata = await request.json();
      expect(metadata).toMatchObject({ token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] });
      redirectUri = metadata.redirect_uris[0];
      return Response.json({ ...metadata, client_id: 'fixture-client' }, { status: 201 });
    }
    if (url.pathname === '/token') {
      const body = new URLSearchParams(await request.text());
      if (body.get('grant_type') === 'authorization_code') {
        exchanges++;
        expect(body.get('code')).toBe('fixture-code');
        expect(body.get('redirect_uri')).toBe(redirectUri);
        expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);
        expect(body.get('resource')).toBe(`${base}/mcp`);
        return Response.json({ access_token: 'private-access-1', token_type: 'Bearer', refresh_token: 'private-refresh-1', expires_in: 60 });
      }
      refreshes++;
      expect(body.get('refresh_token')).toBe('private-refresh-1');
      if (rejectRefresh) return Response.json({ error: 'invalid_grant', error_description: 'private-refresh-1' }, { status: 400 });
      return Response.json({ access_token: `private-access-${refreshes + 1}`, token_type: 'Bearer', expires_in: 3600 });
    }
    if (url.pathname === '/mcp') {
      if (!request.headers.get('authorization')) return new Response(null, { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` } });
      if (request.method === 'GET') return new Response(null, { status: 405 });
      expect(request.headers.get('authorization')).toMatch(/^Bearer private-access-/);
      const rpc = await request.json();
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = rpc.method === 'initialize' ? { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } : rpc.method === 'tools/list' ? { tools: [{ name: 'read_status', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } : { content: [{ type: 'text', text: 'fixture result' }] };
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
    }
    return new Response('Not found', { status: 404 });
  } });
  const endpoint = `http://127.0.0.1:${server.port}/mcp`;
  const connection: ToolConnection = { id: 'fixture', name: 'Fixture', kind: 'mcp', endpoint, enabled: false, discoveredAt: null };
  const credentials = { resolve: async (id: string) => secrets.get(id) ?? null, store: async (id: string, value: string) => { secrets.set(id, value); }, forget: async (id: string) => { secrets.delete(id); return 'removed' as const; }, forgetAll: async () => ({ removed: secrets.size, failed: [] as string[] }) };
  const options = { connection: (id: string) => id === connection.id ? connection : undefined, redirectUrl: `http://127.0.0.1:4317${MCP_OAUTH_CALLBACK_PATH}`, credentials, now: () => clock };
  const oauth = createMcpOAuthService(options);
  const start = async () => {
    const result = await oauth.start('fixture');
    const authorization = new URL(result.authorizationUrl);
    challenge = authorization.searchParams.get('code_challenge')!;
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(options.redirectUrl);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('iss', new URL(endpoint).origin);
    return { result, callback };
  };
  return { oauth, options, start, secrets, connection, close: () => server.stop(true), advance: () => { clock += 61_000; }, expire: () => { clock += 301_000; }, failRefresh: () => { rejectRefresh = true; }, counts: () => ({ exchanges, refreshes }) };
}

test('official OAuth discovery, DCR, PKCE and token exchange feed remote discover/invoke and survive service recreation', async () => {
  const f = fixture();
  try {
    const { result, callback } = await f.start();
    expect(result.status).toBe('authorizing');
    expect(await f.oauth.callback(callback)).toBe(true);
    expect(await f.oauth.callback(callback)).toBe(false);
    expect(await f.oauth.status('fixture', result.sessionId!)).toMatchObject({ status: 'connected', error: null });
    expect(JSON.stringify(await f.oauth.status('fixture'))).not.toContain('private-');
    expect(await f.oauth.accessToken('fixture')).toBe('private-access-1');
    const reopened = createMcpOAuthService(f.options);
    expect((await reopened.status('fixture')).status).toBe('connected');
    const movedPort = createMcpOAuthService({ ...f.options, redirectUrl: `http://127.0.0.1:5555${MCP_OAUTH_CALLBACK_PATH}` });
    expect(await movedPort.accessToken('fixture')).toBe('private-access-1');
    const remote = createRemoteToolConnector({ credentials: (id) => reopened.accessToken(id) });
    const operations = await remote.discover(f.connection);
    expect(operations[0]!.definition).toMatchObject({ enabled: false, effect: 'read' });
    expect(await operations[0]!.handler({}, new AbortController().signal)).toEqual({ content: [{ type: 'text', text: 'fixture result' }] });
    expect(f.connection.enabled).toBe(false);
    f.advance();
    expect(await Promise.all(Array.from({ length: 8 }, () => reopened.accessToken('fixture')))).toEqual(Array(8).fill('private-access-2'));
    expect(f.counts()).toEqual({ exchanges: 1, refreshes: 1 });
    // A rotated response may omit refresh_token; the previous refresh token remains usable.
    await reopened.accessToken('fixture', 'private-access-2');
    expect(f.counts().refreshes).toBe(2);
    expect(await Promise.all(Array.from({ length: 8 }, () => reopened.accessToken('fixture', 'private-access-3')))).toEqual(Array(8).fill('private-access-4'));
    expect(f.counts().refreshes).toBe(3);
    await reopened.disconnect('fixture');
    expect(f.secrets.size).toBe(0);
    expect(await reopened.accessToken('fixture')).toBeNull();
  } finally { f.close(); }
});

test('state, callback origin, duplicate parameters, cancellation and session expiry protect code exchange', async () => {
  const f = fixture();
  try {
    const first = await f.start();
    const wrong = new URL(first.callback); wrong.searchParams.set('state', 'wrong');
    expect(await f.oauth.callback(wrong)).toBe(false);
    const origin = new URL(first.callback); origin.hostname = 'localhost';
    expect(await f.oauth.callback(origin)).toBe(false);
    const duplicate = new URL(first.callback); duplicate.searchParams.append('state', 'wrong');
    expect(await f.oauth.callback(duplicate)).toBe(false);
    await f.oauth.cancel('fixture', first.result.sessionId!);
    expect(await f.oauth.callback(first.callback)).toBe(false);
    expect((await f.oauth.status('fixture')).status).toBe('cancelled');
    const second = await f.start(); f.expire();
    expect(await f.oauth.callback(second.callback)).toBe(false);
    expect((await f.oauth.status('fixture')).status).toBe('expired');
    expect(f.counts().exchanges).toBe(0);
  } finally { f.close(); }
});

test('issuer mix-up, denied consent and superseded sessions never store tokens', async () => {
  const f = fixture();
  try {
    const old = await f.start();
    const fresh = await f.start();
    expect(await f.oauth.callback(old.callback)).toBe(false);
    fresh.callback.searchParams.set('iss', 'https://unrelated.example');
    expect(await f.oauth.callback(fresh.callback)).toBe(false);
    expect(f.counts().exchanges).toBe(0);
    const denied = await f.start(); denied.callback.searchParams.set('error', 'access_denied');
    expect(await f.oauth.callback(denied.callback)).toBe(false);
    expect((await f.oauth.status('fixture')).status).toBe('failed');
    expect(await f.oauth.accessToken('fixture')).toBeNull();
  } finally { f.close(); }
});

test('disconnect reports failed deletion and removes credentials even after connection removal', async () => {
  const f = fixture();
  try {
    const { callback } = await f.start();
    expect(await f.oauth.callback(callback)).toBe(true);
    const failedRemoval = createMcpOAuthService({ ...f.options, credentials: { ...f.options.credentials, forget: async () => 'failed' } });
    await expect(failedRemoval.disconnect('fixture')).rejects.toThrow('could not be removed');
    expect(f.secrets.size).toBe(1);
    const removedConnection = createMcpOAuthService({ ...f.options, connection: () => undefined });
    expect((await removedConnection.disconnect('fixture')).status).toBe('disconnected');
    expect(f.secrets.size).toBe(0);
  } finally { f.close(); }
});

test('cancelling during token persistence restores the previous keychain record', async () => {
  const f = fixture();
  try {
    let notifyWrite!: () => void;
    let finishWrite!: () => void;
    const writing = new Promise<void>((resolve) => { notifyWrite = resolve; });
    const released = new Promise<void>((resolve) => { finishWrite = resolve; });
    const oauth = createMcpOAuthService({ ...f.options,
      fetchImpl: (async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname === '/token') return Response.json({ access_token: 'private-access', token_type: 'Bearer', refresh_token: 'private-refresh', expires_in: 60 });
        return fetch(input, init);
      }) as typeof fetch,
      credentials: { ...f.options.credentials, store: async (id, value) => {
        await f.options.credentials.store(id, value);
        if (JSON.parse(value).tokens) { notifyWrite(); await released; }
      } }
    });
    const started = await oauth.start('fixture');
    const callback = new URL(f.options.redirectUrl);
    callback.searchParams.set('state', new URL(started.authorizationUrl).searchParams.get('state')!);
    callback.searchParams.set('code', 'fixture-code');
    const before = [...f.secrets.values()][0];
    const completion = oauth.callback(callback);
    await writing;
    const cancellation = oauth.cancel('fixture', started.sessionId!);
    finishWrite();
    expect(await completion).toBe(false);
    expect((await cancellation).status).toBe('cancelled');
    expect([...f.secrets.values()][0]).toBe(before);
    expect(await oauth.accessToken('fixture')).toBeNull();
  } finally { f.close(); }
});

test('refresh errors remain sanitized and missing keychain writes fail sign-in', async () => {
  const f = fixture();
  try {
    const { callback } = await f.start();
    expect(await f.oauth.callback(callback)).toBe(true);
    f.failRefresh(); f.advance();
    await expect(f.oauth.accessToken('fixture')).rejects.toThrow('The MCP sign-in could not be refreshed. Sign in again.');
    expect(await f.oauth.accessToken('fixture')).toBeNull();
    expect((await f.oauth.status('fixture')).status).toBe('failed');
    const unavailable = createMcpOAuthService({ ...f.options, credentials: { ...f.options.credentials, resolve: async () => null, store: async () => { throw new Error('private-keychain-detail'); } } });
    await expect(unavailable.start('fixture')).rejects.toThrow('Browser sign-in could not be completed.');
    expect(JSON.stringify(await unavailable.status('fixture'))).not.toContain('private-');
  } finally { f.close(); }
});
