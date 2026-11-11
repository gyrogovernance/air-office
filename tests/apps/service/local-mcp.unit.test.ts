import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalToolConnector, createSqliteToolStore, createToolsService } from '@office/tools/service';
import { createLocalMcpRoutes } from '../../../apps/service/src/local-mcp.route';

test('local MCP HTTP contract requires approval and reports actual unavailable state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'air-local-route-'));
  const store = createSqliteToolStore(join(directory, 'tools.sqlite'));
  const tools = createToolsService(store, {});
  const local = createLocalToolConnector({ installationDirectory: join(directory, 'packages'), credentials: async () => null, nodeExecutable: join(directory, 'missing-node.exe') });
  tools.saveConnection({ id: 'resend', name: 'Resend', kind: 'mcp', endpoint: null, discoveredAt: null, enabled: true, local: { catalogId: 'resend' } });
  const route = createLocalMcpRoutes(tools, local);
  const request = (action: string, method = 'POST', body?: unknown) => route(new Request(`http://localhost/api/v1/tools/connections/resend/local/${action}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  try {
    expect(await (await request('status', 'GET')).json()).toEqual({ status: { installed: false, running: false, package: 'resend-mcp@2.27.1' } });
    expect((await request('install')).status).toBe(409);
    const install = await request('install', 'POST', { approved: true });
    expect(install.status).toBe(502);
    expect((await install.json()).error).toContain('Node.js');
    const start = await request('start', 'POST', { approved: true });
    expect(start.status).toBe(502);
    expect((await start.json()).error).toContain('Install');
    expect((await request('stop')).status).toBe(200);
    expect((await request('status')).status).toBe(405);
    tools.removeConnection('resend');
    expect((await request('status', 'GET')).status).toBe(404);
    expect(tools.definitions().filter((item) => item.connectionId === 'resend')).toEqual([]);
  } finally { await local.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
