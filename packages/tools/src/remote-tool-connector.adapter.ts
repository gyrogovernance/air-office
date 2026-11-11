import type { JsonSchema, ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { isJsonSchema } from '@office/contracts/tool';
import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ToolHandler } from './tools.domain.public';

type JsonRecord = Record<string, unknown>;
type CredentialResolver = (connectionId: string, endpoint?: string) => Promise<string | null>;
type McpTransport = StreamableHTTPClientTransport | SSEClientTransport;

class RemoteMcpError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

const record = (value: unknown): JsonRecord | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

function localReference(value: unknown, root: JsonRecord, seen: Set<string>): JsonRecord | null {
  const reference = record(value)?.$ref;
  if (reference === undefined) return record(value);
  if (typeof reference !== 'string' || !reference.startsWith('#/') || seen.has(reference)) return null;
  const target = reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce<unknown>((current, part) => record(current)?.[part], root);
  if (record(target)?.$ref) return localReference(target, root, new Set([...seen, reference]));
  return record(target);
}

function openApiSchema(value: unknown, root?: JsonRecord, seen = new Set<string>(), depth = 0): JsonSchema | null {
  if (depth > 32) return null;
  const schema = root ? localReference(value, root, seen) : record(value);
  if (!schema) return { type: 'object', properties: {}, additionalProperties: false };
  // Servers publish full JSON Schema: a dialect marker and per-field defaults
  // are common. The tool contract carries neither, so both are dropped rather
  // than failing the whole definition.
  const type = schema.type;
  if (type === 'object') {
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(record(schema.properties) ?? {})) {
      const converted = openApiSchema(child, root, seen, depth + 1);
      if (!converted) return null;
      properties[key] = converted;
    }
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    return { type, properties, required, additionalProperties: typeof schema.additionalProperties === 'boolean' ? schema.additionalProperties : undefined, ...(typeof schema.description === 'string' ? { description: schema.description.slice(0, 2000) } : {}) };
  }
  if (type === 'array') {
    const items = openApiSchema(schema.items, root, seen, depth + 1);
    return items ? { type, items } : null;
  }
  if (['string', 'integer', 'number', 'boolean'].includes(String(type))) {
    // The tool contract keeps bounds non-negative, so a negative bound is
    // dropped rather than failing the definition. A 64-bit id range is the
    // common case: the bound carries no meaning for the reader.
    const bound = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { value } : {};
    const minimum = bound(schema.minimum);
    const maximum = bound(schema.maximum);
    const minLength = bound(schema.minLength);
    const maxLength = bound(schema.maxLength);
    return { type: type as 'string' | 'integer' | 'number' | 'boolean', ...(Array.isArray(schema.enum) ? { enum: schema.enum.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)) } : {}), ...('value' in minimum ? { minimum: minimum.value } : {}), ...('value' in maximum ? { maximum: maximum.value } : {}), ...('value' in minLength ? { minLength: minLength.value } : {}), ...('value' in maxLength ? { maxLength: maxLength.value } : {}), ...(typeof schema.description === 'string' ? { description: schema.description.slice(0, 2000) } : {}) };
  }
  if (type === undefined) return { type: 'string' };
  return null;
}

function openApiOperations(value: unknown, connection: ToolConnection, specUrl: URL, fetchImpl: typeof fetch, credentials: CredentialResolver): { definition: ToolDefinition; handler: ToolHandler }[] {
  const spec = record(value);
  if (!spec || typeof spec.paths !== 'object' || spec.paths === null) throw new Error('The server did not return a valid API description.');
  const configuredServer = Array.isArray(spec.servers) ? record(spec.servers[0]) : null;
  let apiBase: URL;
  try {
    if (typeof configuredServer?.url === 'string') apiBase = new URL(configuredServer.url, specUrl);
    else {
      const endpoint = new URL(connection.endpoint!);
      apiBase = /\.ya?ml$|\.json$/i.test(endpoint.pathname) ? new URL('.', endpoint) : endpoint;
    }
  } catch { throw new Error('The API description has an invalid service address.'); }
  if (apiBase.protocol !== 'http:' && apiBase.protocol !== 'https:') throw new Error('The API description has an invalid service address.');
  if (!apiBase.pathname.endsWith('/')) apiBase.pathname += '/';
  const output: { definition: ToolDefinition; handler: ToolHandler }[] = [];
  for (const [path, methods] of Object.entries(record(spec.paths) ?? {})) {
    for (const [method, operationValue] of Object.entries(record(methods) ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const operation = record(operationValue);
      if (!operation) continue;
      const operationId = typeof operation.operationId === 'string' ? operation.operationId : '';
      const name = safeName(operationId);
      if (!name) continue;
      const props: Record<string, JsonSchema> = {};
      const required: string[] = [];
      const parameters = (Array.isArray(operation.parameters) ? operation.parameters : []).map((raw) => localReference(raw, spec, new Set())).filter((parameter): parameter is JsonRecord => parameter !== null);
      for (const parameter of parameters) {
        if (typeof parameter.name !== 'string' || !['path', 'query'].includes(String(parameter.in))) continue;
        const schema = openApiSchema(parameter.schema, spec);
        if (!schema) continue;
        props[parameter.name] = schema;
        if (parameter.required === true || parameter.in === 'path') required.push(parameter.name);
      }
      const requestBody = localReference(operation.requestBody, spec, new Set());
      const media = record(requestBody && record(requestBody.content)?.['application/json']);
      const bodySchema = media ? openApiSchema(media.schema, spec) : null;
      if (bodySchema) { props.body = bodySchema; if (requestBody?.required === true) required.push('body'); }
      const inputSchema: JsonSchema = { type: 'object', properties: props, required, additionalProperties: false };
      if (!isJsonSchema(inputSchema)) continue;
      const definition: ToolDefinition = { id: `${connection.id}:${operationId}`, connectionId: connection.id, name, description: typeof operation.summary === 'string' ? operation.summary.slice(0, 2000) : typeof operation.description === 'string' ? operation.description.slice(0, 2000) : `${method.toUpperCase()} ${path}`, inputSchema, effect: method === 'get' ? 'read' : 'mutate', enabled: false };
      output.push({ definition, handler: async (input, signal) => {
        const url = new URL(path.replace(/^\/+/, '').replace(/\{([^}]+)\}/g, (_match, key: string) => encodeURIComponent(String(input[key] ?? ''))), apiBase);
        for (const parameter of parameters) {
          if (parameter.in === 'query' && typeof parameter.name === 'string' && input[parameter.name] !== undefined) url.searchParams.set(parameter.name, String(input[parameter.name]));
        }
        const token = await credentials(connection.id, connection.endpoint ?? undefined);
        const response = await fetchImpl(url, { method: method.toUpperCase(), signal, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(input.body === undefined ? {} : { 'content-type': 'application/json' }) , accept: 'application/json' }, ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) });
        if (!response.ok) throw new Error(`The connected server returned status ${response.status}.`);
        if (response.status === 204) return { status: 'complete' };
        const text = await response.text();
        if (text.length > 1_000_000) throw new Error('The server response is too large to display.');
        try { return JSON.parse(text) as unknown; } catch { return { text: text.slice(0, 20000) }; }
      } });
    }
  }
  return output;
}

export function createRemoteToolConnector(options: { credentials: CredentialResolver; refreshCredentials?: (connectionId: string, rejectedToken: string) => Promise<string | null>; fetchImpl?: typeof fetch; requestTimeoutMs?: number } = { credentials: async () => null }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const credentials = options.credentials;
  const timeout = Math.max(1, Math.min(options.requestTimeoutMs ?? 30_000, 120_000));
  const withMcp = async <T>(connection: ToolConnection, run: (client: Client, signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> => {
    const deadline = AbortSignal.timeout(timeout);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    let endpoint: URL;
    try {
      endpoint = new URL(connection.endpoint!);
      if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
    } catch { throw new RemoteMcpError('The MCP connection has an invalid service address.'); }
    let client: Client | undefined;
    let transport: McpTransport | undefined;
    const lifetime = new AbortController();
    const sessionSignal = AbortSignal.any([signal, lifetime.signal]);
    let cleaning = false;
    // Keep credential lookup bound to the configured endpoint, including legacy SSE message URLs.
    const authenticatedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const networkSignal = cleaning ? AbortSignal.timeout(1000) : sessionSignal;
      networkSignal.throwIfAborted();
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== endpoint.origin || url.username || url.password) throw new RemoteMcpError('The MCP server returned an invalid message address.');
      const headers = new Headers(init?.headers);
      headers.delete('authorization');
      const token = await untilAborted(credentials(connection.id, connection.endpoint ?? undefined), networkSignal);
      if (token) headers.set('authorization', `Bearer ${token}`);
      const fetchSignal = init?.signal ? AbortSignal.any([networkSignal, init.signal]) : networkSignal;
      const send = () => untilAborted(fetchImpl(input, { ...init, headers, redirect: 'error', signal: fetchSignal }), fetchSignal);
      let response = await send();
      if (response.status === 401 && token && options.refreshCredentials && !cleaning) {
        void response.body?.cancel().catch(() => undefined);
        const refreshed = await untilAborted(options.refreshCredentials(connection.id, token), networkSignal);
        if (refreshed) {
          headers.set('authorization', `Bearer ${refreshed}`);
          response = await send();
        }
      }
      // Do not let upstream status/body diagnostics expose provider responses or tokens.
      // A GET 405 is the supported Streamable HTTP signal for no background SSE stream.
      if (!response.ok && !(init?.method === 'GET' && response.status === 405)) {
        void response.body?.cancel().catch(() => undefined);
        throw new RemoteMcpError(`The MCP server returned status ${response.status}.`, response.status);
      }
      if (!response.body || !response.ok) return response;
      const reader = response.body.getReader();
      let size = 0;
      let abort: () => void;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          abort = () => {
            void reader.cancel().catch(() => undefined);
            try { controller.error(new RemoteMcpError('The MCP response stream was closed.')); } catch { /* Stream already completed. */ }
          };
          networkSignal.addEventListener('abort', abort, { once: true });
        },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              networkSignal.removeEventListener('abort', abort);
              controller.close();
            } else {
              size += chunk.value.byteLength;
              if (size > 1_000_000) throw new RemoteMcpError('The MCP server response is too large to read.');
              controller.enqueue(chunk.value);
            }
          } catch {
            networkSignal.removeEventListener('abort', abort);
            void reader.cancel().catch(() => undefined);
            controller.error(new RemoteMcpError('The MCP response stream could not be read.'));
          }
        },
        cancel() {
          networkSignal.removeEventListener('abort', abort);
          return reader.cancel().catch(() => undefined);
        }
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    const close = async () => {
      // Closing the transport first also unblocks an unfinished SSE start().
      await transport?.close().catch(() => undefined);
      await client?.close().catch(() => undefined);
    };
    try {
      signal.throwIfAborted();
      const connect = async (legacy: boolean) => {
        client = new Client({ name: 'AIR Office', version: '0.1.0' });
        const settings = { fetch: authenticatedFetch, requestInit: { redirect: 'error' as const } };
        transport = legacy ? new SSEClientTransport(endpoint, settings) : new StreamableHTTPClientTransport(endpoint, { ...settings, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } });
        await untilAborted(client.connect(transport, { signal, timeout }), signal);
      };
      try { await connect(false); }
      catch (error) {
        await close();
        // Retry only transport incompatibility, never rejected authentication or failed calls.
        if (!(error instanceof RemoteMcpError) || ![404, 405, 406, 415].includes(error.status ?? 0)) throw error;
        await connect(true);
      }
      return await untilAborted(run(client!, signal), signal);
    } catch (error) {
      if (signal.aborted) throw new RemoteMcpError(callerSignal?.aborted ? 'The MCP request was cancelled.' : 'The MCP request timed out.');
      if (error instanceof RemoteMcpError) throw error;
      // Opt-in diagnostics only. Production clients keep the sanitized message.
      if (process.env.OFFICE_MCP_DEBUG === '1') {
        console.warn(JSON.stringify({
          component: 'remote-mcp',
          operation: 'withMcp',
          outcome: 'failed',
          name: error instanceof Error ? error.name : 'unknown',
          message: error instanceof Error ? error.message.slice(0, 500) : 'non-error',
        }));
      }
      throw new RemoteMcpError('The MCP server could not complete the request.');
    } finally {
      cleaning = true;
      if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
        const cleanupDeadline = AbortSignal.timeout(1000);
        await untilAborted(transport.terminateSession(), cleanupDeadline).catch(() => undefined);
      }
      lifetime.abort();
      await close();
    }
  };
  return {
    async discover(connection: ToolConnection): Promise<{ definition: ToolDefinition; handler: ToolHandler }[]> {
      if (connection.kind === 'builtin') return [];
      if (connection.kind === 'openapi') {
        const base = new URL(connection.endpoint!);
        const specUrl = /\.json$|\.ya?ml$/i.test(base.pathname) ? base : new URL('openapi.json', `${base.href.replace(/\/?$/, '/')}`);
        const token = await credentials(connection.id, connection.endpoint ?? undefined);
        const response = await fetchImpl(specUrl, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`The API description returned status ${response.status}.`);
        const text = await response.text();
        if (text.length > 1_000_000) throw new Error('The API description is too large to read.');
        return openApiOperations(JSON.parse(text), connection, specUrl, fetchImpl, credentials);
      }
      const entries = await withMcp(connection, async (client, signal) => (await client.listTools(undefined, { signal, timeout })).tools);
      return entries.flatMap((raw) => {
        const item = record(raw);
        const name = item && typeof item.name === 'string' ? safeName(item.name) : '';
        const inputSchema = item ? openApiSchema(item.inputSchema) : null;
        if (!name || !inputSchema || inputSchema.type !== 'object') return [];
        const originalName = item!.name as string;
        const annotations = record(item!.annotations);
        const effect = annotations?.readOnlyHint === true && annotations.destructiveHint !== true ? 'read' : 'mutate';
        const definition: ToolDefinition = { id: `${connection.id}:${originalName}`, connectionId: connection.id, name, description: typeof item!.description === 'string' ? item!.description.slice(0, 2000) : name, inputSchema, effect, enabled: false };
        return [{ definition, handler: async (input, signal) => {
          const result = await withMcp(connection, (client, requestSignal) => client.callTool({ name: originalName, arguments: input }, { signal: requestSignal, timeout, toolDefinition: raw }), signal);
          if (result.isError) throw new Error('The remote MCP tool reported an execution error.');
          return result;
        } }];
      });
    },
    install(operations: { definition: ToolDefinition; handler: ToolHandler }[], setHandler: (id: string, handler: ToolHandler) => void): void {
      for (const operation of operations) setHandler(operation.definition.id, operation.handler);
    }
  };
}
