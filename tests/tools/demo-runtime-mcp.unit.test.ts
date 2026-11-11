import { expect, test } from 'bun:test';
import { createRemoteToolConnector } from '../../packages/tools/src/remote-tool-connector.adapter';
import { startDemoRuntime } from '../../tools/demo-runtime.adapter';

test('demo MCP endpoint speaks Streamable HTTP so discover does not 502', async () => {
  const runtime = startDemoRuntime();
  try {
    const endpoint = `${runtime.url.origin}/mcp`;
    expect((await fetch(endpoint, { method: 'GET', headers: { accept: 'text/event-stream' } })).status).toBe(405);
    const remote = createRemoteToolConnector({ credentials: async () => null });
    const operations = await remote.discover({
      id: 'demo-mcp',
      name: 'MCP · Demo',
      kind: 'mcp',
      endpoint,
      discoveredAt: null,
      enabled: false,
    });
    expect(operations.map((operation) => operation.definition.id)).toEqual(['demo-mcp:echo']);
    expect(operations[0]?.definition.effect).toBe('read');
  } finally {
    runtime.stop(true);
  }
});
