import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalToolConnector, createSqliteToolStore, createToolsService } from '@office/tools/service';
import { createLocalMcpRoutes } from '../../../apps/service/src/local-mcp.route';

test('approved local start discovers real child tools and stop/removal/shutdown prevent reuse', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'air-local-live-'));
  const store = createSqliteToolStore(join(directory, 'tools.sqlite'));
  const tools = createToolsService(store, {});
  const packageRoot = join(directory, 'packages', 'resend', 'node_modules', 'resend-mcp');
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version: '2.27.1' }));
  writeFileSync(join(packageRoot, 'dist', 'index.js'), `
    const input = require('node:readline').createInterface({input:process.stdin});
    input.on('line', line => {
      const m=JSON.parse(line); let result;
      if(m.method==='initialize') result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
      if(m.method==='tools/list') result={tools:[{name:'echo',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]};
      if(m.method==='tools/call') result={content:[{type:'text',text:'ok'}]};
      if(result) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
    });
    input.on('close',()=>process.exit(0));
  `);
  const local = createLocalToolConnector({ installationDirectory: join(directory, 'packages'), credentials: async () => 'fixture-secret', nodeExecutable: process.execPath });
  tools.saveConnection({ id: 'resend', name: 'Resend', kind: 'mcp', endpoint: null, discoveredAt: null, enabled: true, local: { catalogId: 'resend' } });
  const route = createLocalMcpRoutes(tools, local);
  const request = (action: string) => route(new Request(`http://localhost/api/v1/tools/connections/resend/local/${action}`, { method: 'POST', body: JSON.stringify({ approved: true }) }));
  try {
    const started = await request('start');
    expect(started.status).toBe(200);
    expect((await started.json()).status.running).toBe(true);
    const definition = tools.definitions().find((item) => item.connectionId === 'resend')!;
    tools.saveDefinition({ ...definition, enabled: true });
    expect((await tools.invoke(definition.id, {})).status).toBe('succeeded');
    expect((await request('stop')).status).toBe(200);
    expect((await tools.invoke(definition.id, {})).status).toBe('failed');
    expect((await request('start')).status).toBe(200);
    expect(tools.definitions().find((item) => item.id === definition.id)?.enabled).toBe(true);
    await local.close();
    expect(local.status(tools.connections().find((item) => item.id === 'resend')!).running).toBe(false);
    tools.removeConnection('resend');
    expect(tools.definitions().some((item) => item.connectionId === 'resend')).toBe(false);
    expect((await tools.invoke(definition.id, {})).status).toBe('failed');
  } finally { await local.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
