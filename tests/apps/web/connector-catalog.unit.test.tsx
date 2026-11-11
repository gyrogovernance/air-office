import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import type { ServiceClient } from '../../../apps/web/src/shared/service-client.hook';
import { CONNECTOR_PRESETS, connectorStatus, matchesConnector } from '../../../apps/web/src/tools/connector-catalog.policy';
import '../../support/web-dom.adapter';

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ConnectorCatalog } = await import('../../../apps/web/src/tools/connector-catalog.component');
const { ToolsWorkspace } = await import('../../../apps/web/src/tools/tools-workspace.component');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');
let host: HTMLElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let connections: ToolConnection[] = [];
let definitions: ToolDefinition[] = [];
const calls: { path: string; method?: string; body?: Record<string, unknown> }[] = [];
const client: ServiceClient = { base: 'http://localhost', token: async () => 'test', request: async () => Response.json({}), json: async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
  calls.push({ path, method: init?.method, body });
  if (path === '/api/v1/tools') return { connections: [...connections], definitions: [...definitions] } as T;
  if (path === '/api/v1/capabilities') return { webSearch: { configured: true, provider: 'test' }, codeInterpreter: { languages: ['javascript'] }, memory: { enabled: false }, providers: [] } as T;
  if (path === '/api/v1/tools/connections' && init?.method === 'POST') { connections.push({ id: String(body!.id), name: String(body!.name), endpoint: typeof body!.endpoint === 'string' ? body!.endpoint : null, ...(body!.local ? { local: body!.local as ToolConnection['local'] } : {}), kind: 'mcp', enabled: false, discoveredAt: null }); return {} as T; }
  if (path.endsWith('/oauth/start')) return { authorizationUrl: 'https://accounts.example.com/authorize?state=test', sessionId: 'session-test' } as T;
  if (init?.method === 'PATCH') { connections[0]!.enabled = Boolean(body!.enabled); return {} as T; }
  if (path.endsWith('/local/status')) return { status: { installed: true, running: false, package: 'resend-mcp@2.27.1' } } as T;
  if (/\/local\/(install|start|stop)$/.test(path)) return {} as T;
  if (path.includes('/oauth/status')) return { status: 'authorizing' } as T;
  if (path.endsWith('/oauth/cancel')) return {} as T;
  if (path.endsWith('/credential')) return {} as T;
  if (path.endsWith('/discover')) {
    const connection = connections[0]!; connection.discoveredAt = new Date().toISOString();
    definitions = [{ id: 'search', connectionId: connection.id, name: 'Search sources', description: 'Search indexed websites.', inputSchema: { type: 'object' }, effect: 'read', enabled: false }];
    return { definitions } as T;
  }
  if (path === '/api/v1/tools/enable') { definitions[0]!.enabled = Boolean(body!.enabled); return {} as T; }
  throw new Error(`Unexpected request: ${path}`);
} };
async function render() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root!.render(createElement(ConnectorCatalog, { client }))); }
function button(label: string) { const item = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.getAttribute('aria-label') === label || node.textContent === label); if (!item) throw new Error(`Missing button: ${label}`); return item; }
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; calls.length = 0; connections = []; definitions = []; });

test('catalog includes all 21 services and requires discovery independently of enabling', () => {
  expect(CONNECTOR_PRESETS).toHaveLength(21);
  const preset = CONNECTOR_PRESETS[0]!;
  const connection: ToolConnection = { id: 'custom', name: 'Renamed', kind: 'mcp', endpoint: preset.endpoint, enabled: true, discoveredAt: null };
  expect(matchesConnector(preset, connection)).toBe(true);
  expect(matchesConnector(preset, { ...connection, endpoint: 'https://mcp.exa.ai.evil.example/mcp' })).toBe(false);
  expect(connectorStatus(connection)).toBe('Needs discovery');
  expect(connectorStatus({ ...connection, discoveredAt: '2026-10-18', enabled: false })).toBe('Paused');
});

test('renders catalog and filters by category without network catalog requests', async () => {
  await render();
  expect(host!.querySelectorAll('.connector-card')).toHaveLength(21);
  expect(host!.querySelectorAll('svg[data-brand]')).toHaveLength(17);
  expect(host!.querySelectorAll('[data-brand-fallback]')).toHaveLength(2);
  expect(host!.querySelector('svg[data-brand="linear"] path')?.getAttribute('d')?.length).toBeGreaterThan(20);
  await act(async () => { [...host!.querySelectorAll<HTMLElement>('[role="button"], [role="tab"], button, [id="Research"], [data-id="Research"], .connector-filters *')].find((node) => node.textContent === 'Research')?.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(host!.querySelectorAll('.connector-card')).toHaveLength(3);
  expect(calls.every((call) => call.path === '/api/v1/tools')).toBe(true);
});

test('reuses an existing endpoint and reviews discovered tools without automatically enabling them', async () => {
  connections = [{ id: 'existing', name: 'My Exa', kind: 'mcp', endpoint: 'https://mcp.exa.ai/mcp', enabled: false, discoveredAt: null }];
  await render();
  await act(async () => button('Manage Exa').click());
  await act(async () => button('Discover tools').click());
  expect(calls.some((call) => call.path.endsWith('/existing/discover'))).toBe(true);
  expect(calls.some((call) => call.path === '/api/v1/tools/connections')).toBe(false);
  expect(definitions[0]!.enabled).toBe(false);
  expect(connections[0]!.enabled).toBe(false);
  const toggle = document.querySelector<HTMLInputElement>('input[aria-label="Enable Search sources"]')!;
  await act(async () => toggle.click());
  expect(definitions[0]!.enabled).toBe(true);
});

test('local setup requires explicit approval and saves a curated local configuration', async () => {
  await render(); await act(async () => button('Set up Resend').click());
  expect(button('Install package').disabled).toBe(true);
  expect(calls.some((call) => call.path === '/api/v1/tools/connections')).toBe(false);
  const approve = document.querySelector<HTMLInputElement>('.connector-approval input')!;
  await act(async () => approve.click());
  await act(async () => button('Install package').click());
  const saved = calls.find((call) => call.path === '/api/v1/tools/connections')!.body!;
  expect(saved.local).toEqual({ catalogId: 'resend' });
  expect(saved.endpoint).toBeNull();
  expect(calls.find((call) => call.path.endsWith('/local/install'))?.body).toEqual({ approved: true });
  expect(button('Enable and start connector').disabled).toBe(true);
  await act(async () => approve.click());
  await act(async () => button('Enable and start connector').click());
  expect(calls.find((call) => call.path.endsWith('/local/start'))?.body).toEqual({ approved: true });
});

test('browser sign-in shows a fallback link and cancels its service session', async () => {
  const openMock = spyOn(window, 'open').mockReturnValue(null);
  try {
    await render(); await act(async () => button('Set up Linear').click());
    await act(async () => button('Sign in with browser').click());
    expect(button('Open sign-in page ↗')).not.toBeNull();
    expect(calls.some((call) => call.path.endsWith('/connector-linear/oauth/start'))).toBe(true);
    await act(async () => button('Cancel sign-in').click());
    expect(calls.find((call) => call.path.endsWith('/oauth/cancel'))?.body).toEqual({ sessionId: 'session-test' });
    expect(connections[0]!.enabled).toBe(false);
  } finally { openMock.mockRestore(); }
});

test('curated mutating tools remain available for manual review and execution', async () => {
  connections = [{ id: 'existing', name: 'My Exa', kind: 'mcp', endpoint: 'https://mcp.exa.ai/mcp', enabled: true, discoveredAt: '2026-10-18' }];
  definitions = [{ id: 'write', connectionId: 'existing', name: 'Update source', description: 'Update a source.', effect: 'mutate', enabled: true, inputSchema: { type: 'object' } }];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ token: 'test', connections, definitions }), { preconnect: globalThis.fetch.preconnect }));
  try {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(createElement(AppDialogsProvider, null, createElement(ToolsWorkspace))));
    // Tools are listed directly in "Available tools" section
    expect(host.textContent).toContain('Update source');
    await act(async () => button('Review fields and run').click());
    expect(button('Run tool').disabled).toBe(false);
    expect(host.textContent).toContain('AIR Office asks before running it.');
  } finally { fetchMock.mockRestore(); }
});

test('API keys use the service credential route and clear after saving', async () => {
  await render(); await act(async () => button('Set up Firecrawl').click());
  const input = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'fc-test-only'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(button('Save API key').disabled).toBe(false);
  await act(async () => button('Save API key').click());
  expect(calls.find((call) => call.path.endsWith('/credential'))?.body).toEqual({ secret: 'fc-test-only' });
  expect(input.value).toBe('');
  expect(input.autocomplete).toBe('off');
});
