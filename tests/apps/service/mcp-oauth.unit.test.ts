import { expect, test } from 'bun:test';
import { createMcpOAuthRoutes } from '../../../apps/service/src/mcp-oauth.route';
import { createMcpOAuthService, MCP_OAUTH_CALLBACK_PATH } from '@office/tools/oauth';

function routes() {
  const oauth = createMcpOAuthService({
    connection: (id) => id === 'fixture' ? { id, name: 'Fixture', kind: 'mcp', endpoint: 'https://tools.example/mcp', enabled: false, discoveredAt: null } : undefined,
    redirectUrl: `http://127.0.0.1:4317${MCP_OAUTH_CALLBACK_PATH}`,
    credentials: { resolve: async () => null, store: async () => {}, forget: async () => 'removed', forgetAll: async () => ({ removed: 0, failed: [] }) }
  });
  return createMcpOAuthRoutes(oauth);
}

test('OAuth status and disconnect use safe JSON views and exact route contracts', async () => {
  const route = routes();
  const status = await route(new Request('http://127.0.0.1:4317/api/v1/tools/connections/fixture/oauth/status'));
  expect(status.status).toBe(200);
  expect(status.headers.get('cache-control')).toBe('no-store');
  expect(await status.json()).toEqual({ connectionId: 'fixture', sessionId: null, status: 'disconnected', expiresAt: null, error: null });
  const disconnected = await route(new Request('http://127.0.0.1:4317/api/v1/tools/connections/fixture/oauth/disconnect', { method: 'POST' }));
  expect(disconnected.status).toBe(200);
  expect((await disconnected.json()).status).toBe('disconnected');
  expect((await route(new Request('http://127.0.0.1:4317/api/v1/tools/connections/fixture/oauth/start'))).status).toBe(405);
  expect((await route(new Request('http://127.0.0.1:4317/api/v1/tools/connections/fixture/oauth/status?sessionId=unknown'))).status).toBe(400);
  expect((await route(new Request('http://127.0.0.1:4317/api/v1/tools/connections/fixture/oauth/cancel', { method: 'POST', body: '{}' }))).status).toBe(400);
});

test('callback failures return static text without reflecting remote code, state or errors', async () => {
  const route = routes();
  const response = await route(new Request(`http://127.0.0.1:4317${MCP_OAUTH_CALLBACK_PATH}?state=private-state&code=private-code&error_description=private-description`));
  expect(response.status).toBe(400);
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(await response.text()).not.toContain('private-');
  expect((await route(new Request(`http://127.0.0.1:4317${MCP_OAUTH_CALLBACK_PATH}/extra`))).status).toBe(404);
});
