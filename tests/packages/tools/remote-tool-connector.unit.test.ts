import { expect, test } from 'bun:test';
import { createRemoteToolConnector } from '../../../packages/tools/src/remote-tool-connector.adapter';
import type { ToolConnection } from '@office/contracts/tool';

const connection: ToolConnection = { id: 'remote', name: 'Remote', kind: 'mcp', endpoint: 'https://tools.example/mcp', discoveredAt: null, enabled: false };
const tool = { name: 'read', inputSchema: { type: 'object' as const, properties: {} } };
const initialized = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Fixture', version: '1' } };
const result = { content: [{ type: 'text', text: 'done' }] };
type Rpc = { id?: number; method: string; params?: Record<string, unknown> };
const rpcResponse = (rpc: Rpc, value: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id, result: value });

function fixture(onRequest?: (rpc: Rpc, init?: RequestInit) => Response | undefined): typeof fetch {
  return (async (_input, init) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    const rpc = JSON.parse(String(init?.body)) as Rpc;
    return onRequest?.(rpc, init) ?? (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled'
      ? new Response(null, { status: 202 })
      : rpcResponse(rpc, rpc.method === 'initialize' ? initialized : rpc.method === 'tools/list' ? { tools: [tool] } : result));
  }) as typeof fetch;
}

test('remote MCP retries one unauthorized request with endpoint-bound refreshed credentials', async () => {
  let token = 'old-token';
  let refreshes = 0;
  let unauthorized = 0;
  const serve = fixture();
  const remote = createRemoteToolConnector({
    credentials: async (_id, endpoint) => { expect(endpoint).toBe(connection.endpoint!); return token; },
    refreshCredentials: async (id, rejected) => { expect(id).toBe('remote'); expect(rejected).toBe('old-token'); refreshes++; token = 'new-token'; return token; },
    fetchImpl: (async (input, init) => {
      expect(init?.redirect).toBe('error');
      if (new Headers(init?.headers).get('authorization') === 'Bearer old-token') { unauthorized++; return new Response(null, { status: 401 }); }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer new-token');
      return serve(input, init);
    }) as typeof fetch
  });
  const operations = await remote.discover(connection);
  expect(await operations[0]!.handler({}, new AbortController().signal)).toEqual(result);
  expect(refreshes).toBe(1);
  expect(unauthorized).toBe(1);
});

test('remote MCP does not repeat a rejected refreshed token or fall back on unauthorized', async () => {
  let requests = 0;
  const remote = createRemoteToolConnector({ credentials: async () => 'old', refreshCredentials: async () => 'new', fetchImpl: (async () => { requests++; return new Response('secret', { status: 401 }); }) as unknown as typeof fetch });
  await expect(remote.discover(connection)).rejects.toThrow('status 401');
  expect(requests).toBe(2);
});

test('streamable HTTP handles split multiline SSE, unrelated notifications and open response streams', async () => {
  let closed = 0;
  const encoder = new TextEncoder();
  const remote = createRemoteToolConnector({ credentials: async () => null, fetchImpl: fixture((rpc) => {
    if (rpc.method !== 'tools/list') return undefined;
    const frame = `: keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"hello"}}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":${rpc.id},"result":{"tools":[${JSON.stringify(tool)}]}}\r\n\r\n`;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(frame.slice(0, 45)));
      controller.enqueue(encoder.encode(frame.slice(45)));
    }, cancel() { closed++; } }), { headers: { 'content-type': 'text/event-stream' } });
  }) });
  expect((await remote.discover(connection)).map((operation) => operation.definition.name)).toEqual(['read']);
  expect(closed).toBe(1);
});

test('SDK aggregates tool pagination and carries session and protocol headers', async () => {
  let lists = 0;
  let terminated = 0;
  const serve = fixture((rpc, init) => {
    if (rpc.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: initialized }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'session' } });
    expect(new Headers(init?.headers).get('mcp-session-id')).toBe('session');
    expect(new Headers(init?.headers).get('mcp-protocol-version')).toBe('2025-03-26');
    if (rpc.method === 'tools/list') {
      lists++;
      if (!rpc.params?.cursor) return rpcResponse(rpc, { tools: [tool], nextCursor: 'page2' });
      expect(rpc.params.cursor).toBe('page2');
      return rpcResponse(rpc, { tools: [{ ...tool, name: 'second' }] });
    }
    return undefined;
  });
  const remote = createRemoteToolConnector({ credentials: async () => null, fetchImpl: (async (input, init) => {
    if (init?.method === 'DELETE') { terminated++; expect(new Headers(init.headers).get('mcp-session-id')).toBe('session'); }
    return serve(input, init);
  }) as typeof fetch });
  expect((await remote.discover(connection)).length).toBe(2);
  expect(lists).toBe(2);
  expect(terminated).toBe(1);
});

test('a published JSON Schema keeps its fields when it carries a dialect marker, defaults and a negative bound', async () => {
  const published = {
    name: 'thread',
    inputSchema: {
      type: 'object',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: {
        itemId: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991, description: 'The item.' },
        depth: { type: 'integer', default: 3, minimum: 0, maximum: 100 }
      },
      required: ['itemId'],
      additionalProperties: false
    }
  };
  const remote = createRemoteToolConnector({ credentials: async () => null, fetchImpl: fixture((rpc) => rpc.method === 'tools/list' ? rpcResponse(rpc, { tools: [published] }) : undefined) });
  const [operation] = await remote.discover(connection);
  expect(operation!.definition.inputSchema).toEqual({
    type: 'object',
    properties: { itemId: { type: 'integer', maximum: 9007199254740991, description: 'The item.' }, depth: { type: 'integer', minimum: 0, maximum: 100 } },
    required: ['itemId'],
    additionalProperties: false
  });
});

function legacyFixture(crossOrigin = false) {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = 0;
  let calls = 0;
  const encoder = new TextEncoder();
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    if (init?.method === 'POST' && url === connection.endpoint) return new Response(null, { status: 405 });
    if (url === connection.endpoint) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${crossOrigin ? 'https://other.example/messages' : '/messages?session=legacy'}\n\n`));
      init?.signal?.addEventListener('abort', () => { try { controller.close(); } catch { /* Already closed by transport. */ } }, { once: true });
    }, cancel() { closed++; } }), { headers: { 'content-type': 'text/event-stream' } });
    expect(url).toBe('https://tools.example/messages?session=legacy');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key');
    const rpc = JSON.parse(String(init?.body)) as Rpc;
    if (rpc.id !== undefined) {
      if (rpc.method === 'tools/call') calls++;
      stream!.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize' ? initialized : rpc.method === 'tools/list' ? { tools: [tool] } : result })}\n\n`));
    }
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  return { fetchImpl, closed: () => closed, calls: () => calls };
}

test('legacy SSE endpoint fallback discovers and invokes over separate message POSTs', async () => {
  const legacy = legacyFixture();
  const remote = createRemoteToolConnector({ credentials: async (_id, endpoint) => { expect(endpoint).toBe(connection.endpoint!); return 'key'; }, fetchImpl: legacy.fetchImpl });
  const operations = await remote.discover(connection);
  expect(await operations[0]!.handler({}, new AbortController().signal)).toEqual(result);
  expect(legacy.calls()).toBe(1);
});

test('legacy SSE refuses cross-origin message endpoints without sending credentials', async () => {
  const legacy = legacyFixture(true);
  const remote = createRemoteToolConnector({ credentials: async () => 'key', fetchImpl: legacy.fetchImpl });
  await expect(remote.discover(connection)).rejects.toThrow('could not complete');
  expect(legacy.calls()).toBe(0);
});

test('timeout bounds a hanging fetch and aborts its resources', async () => {
  let signal: AbortSignal | null | undefined;
  const remote = createRemoteToolConnector({ credentials: async () => null, requestTimeoutMs: 25, fetchImpl: (async (_input, init) => { signal = init?.signal; return new Promise<Response>(() => undefined); }) as typeof fetch });
  await expect(remote.discover(connection)).rejects.toThrow('timed out');
  expect(signal?.aborted).toBe(true);
});

test('cancellation aborts an active tool call without leaking RPC error text', async () => {
  let started!: () => void;
  const active = new Promise<void>((resolve) => { started = resolve; });
  let requestSignal: AbortSignal | null | undefined;
  const serve = fixture();
  const remote = createRemoteToolConnector({ credentials: async () => null, fetchImpl: (async (input, init) => {
    if (init?.body && (JSON.parse(String(init.body)) as Rpc).method === 'tools/call') {
      requestSignal = init.signal;
      started();
      return new Promise<Response>(() => undefined);
    }
    return serve(input, init);
  }) as typeof fetch });
  const operations = await remote.discover(connection);
  const controller = new AbortController();
  const pending = operations[0]!.handler({}, controller.signal);
  await active;
  controller.abort(new Error('secret-token'));
  await expect(pending).rejects.toThrow('cancelled');
  expect(requestSignal?.aborted).toBe(true);
});

test('server RPC and network diagnostics are sanitized', async () => {
  const remote = createRemoteToolConnector({ credentials: async () => 'secret-token', fetchImpl: fixture((rpc) => rpc.method === 'tools/list' ? Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32603, message: 'secret-token' } }) : undefined) });
  await expect(remote.discover(connection)).rejects.toThrow('The MCP server could not complete the request.');
});

test('OpenAPI discovery and invocation preserve their existing contract', async () => {
  const api = { ...connection, kind: 'openapi' as const, endpoint: 'https://tools.example/api' };
  const paths: string[] = [];
  const remote = createRemoteToolConnector({ credentials: async (_id, endpoint) => { expect(endpoint).toBe(api.endpoint); return 'key'; }, fetchImpl: (async (input, init) => {
    paths.push(String(input));
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer key');
    return paths.length === 1 ? Response.json({ openapi: '3.0.0', paths: { '/items/{id}': { get: { operationId: 'readItem', parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }] } } } }) : Response.json({ ok: true });
  }) as typeof fetch });
  const operations = await remote.discover(api);
  expect(await operations[0]!.handler({ id: 'a/b' }, new AbortController().signal)).toEqual({ ok: true });
  expect(paths).toEqual(['https://tools.example/api/openapi.json', 'https://tools.example/api/items/a%2Fb']);
});
