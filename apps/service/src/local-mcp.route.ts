import type { createLocalToolConnector, ToolsService } from '@office/tools/service';

type LocalConnector = ReturnType<typeof createLocalToolConnector>;

export function createLocalMcpRoutes(tools: ToolsService, local: LocalConnector) {
  return async (request: Request): Promise<Response> => {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/tools\/connections\/([^/]+)\/local\/(status|install|start|stop)$/);
    if (!match) return new Response('Not found', { status: 404 });
    const action = match[2]!;
    const headers = { 'cache-control': 'no-store' };
    if (request.method !== (action === 'status' ? 'GET' : 'POST')) return new Response('Method not allowed', { status: 405, headers });
    let id: string;
    try { id = decodeURIComponent(match[1]!); } catch { return Response.json({ error: 'Invalid connection identifier.' }, { status: 400, headers }); }
    const connection = tools.connections().find((item) => item.id === id);
    if (!connection?.local) return Response.json({ error: 'Choose a saved local MCP connection.' }, { status: 404, headers });
    if (action === 'status') return Response.json({ status: local.status(connection) }, { headers });
    if (action === 'install' || action === 'start') {
      const body = await request.json().catch(() => null) as { approved?: unknown } | null;
      if (body?.approved !== true) return Response.json({ error: 'Explicit user approval is required for this local MCP operation.' }, { status: 409, headers });
    }
    try {
      if (action === 'stop') await local.stop(id);
      if (action === 'install') await local.install(connection, { approved: true }, request.signal);
      if (action === 'start') {
        if (!connection.enabled) return Response.json({ error: 'Enable this connection before starting its local MCP process.' }, { status: 409, headers });
        const operations = await local.start(connection, { approved: true }, request.signal);
        try {
          const previous = tools.definitions().filter((item) => item.connectionId === id);
          for (const operation of operations) {
            const existing = previous.find((item) => item.id === operation.definition.id);
            const unchanged = existing && existing.name === operation.definition.name && existing.effect === operation.definition.effect && JSON.stringify(existing.inputSchema) === JSON.stringify(operation.definition.inputSchema);
            tools.saveDefinition({ ...operation.definition, enabled: unchanged ? existing.enabled : false });
            tools.setHandler(operation.definition.id, operation.handler);
          }
          const ids = new Set(operations.map((item) => item.definition.id));
          for (const removed of previous.filter((item) => !ids.has(item.id))) tools.saveDefinition({ ...removed, enabled: false });
          const updated = { ...connection, discoveredAt: new Date().toISOString() };
          tools.saveConnection(updated);
          return Response.json({ connection: updated, definitions: tools.definitions().filter((item) => item.connectionId === id), status: local.status(updated) }, { headers });
        } catch (error) { await local.stop(id); throw error; }
      }
      return Response.json({ status: local.status(connection) }, { headers });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'The local MCP operation failed.', status: local.status(connection) }, { status: 502, headers });
    }
  };
}
