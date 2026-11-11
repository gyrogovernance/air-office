const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PAGE_SIZE = 30;
const MAX_JSON_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 128_000;
type JsonRecord = Record<string, unknown>;
type DiscoveryFetch = (url: URL, init: RequestInit) => Promise<Response>;
export type MarketDiscoveryOptions = { fetchImpl?: DiscoveryFetch; timeoutMs?: number };
export type MarketMcpEntry = { id: string; name: string; description: string; version: string; sourceUrl: string; endpoint: string | null; transport: string; supported: boolean };
const record = (value: unknown): JsonRecord | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
const text = (value: unknown, limit: number): string => typeof value === 'string' ? value.slice(0, limit) : '';
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
class DiscoveryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Read a single JSON document without buffering an unbounded response body. */
async function readJson(response: Pick<Response, 'headers' | 'body'>, limit: number, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new DiscoveryError('The metadata document is too large.', 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DiscoveryError('The metadata document is empty.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DiscoveryError('The metadata document is too large.', 502); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new DiscoveryError('The source did not return a JSON metadata document.', 502); }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

function endpointUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[{}]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return url.href;
  } catch { return null; }
}

function mcpEntries(value: unknown): { entries: MarketMcpEntry[]; nextCursor: string | null } {
  const data = record(value);
  if (!data || !Array.isArray(data.servers) || data.servers.length > PAGE_SIZE) throw new DiscoveryError('The registry returned an invalid page.', 502);
  const entries = data.servers.flatMap((raw): MarketMcpEntry[] => {
    const wrapper = record(raw);
    const server = record(wrapper?.server);
    if (!server || typeof server.name !== 'string' || typeof server.version !== 'string') return [];
    const official = record(record(wrapper?._meta)?.['io.modelcontextprotocol.registry/official']);
    if (official?.status === 'deleted' || official?.status === 'deprecated') return [];
    const remotes = Array.isArray(server.remotes) ? server.remotes.slice(0, 30).map(record).filter((remote): remote is JsonRecord => remote !== null) : [];
    const remote = remotes.find((item) => item.type === 'streamable-http' && endpointUrl(item.url)) ?? remotes[0];
    const endpoint = endpointUrl(remote?.url);
    const transport = text(remote?.type, 64) || (Array.isArray(server.packages) && server.packages.length ? 'stdio' : 'unknown');
    const supported = transport === 'streamable-http' && endpoint !== null;
    const id = text(server.name, 200);
    const version = text(server.version, 255);
    return [{ id, name: text(server.title, 200) || id, description: text(server.description, 2000), version, sourceUrl: `${MCP_REGISTRY_URL}/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`, endpoint: supported ? endpoint : null, transport, supported }];
  });
  const next = record(data.metadata)?.nextCursor;
  if (next !== undefined && next !== null && (typeof next !== 'string' || next.length > 2048)) throw new DiscoveryError('The registry returned an invalid cursor.', 502);
  return { entries, nextCursor: typeof next === 'string' && next ? next : null };
}

function pluginPreview(value: unknown, sourceUrl: string) {
  const manifest = record(value);
  if (!manifest || manifest.$schema !== PLUGIN_SCHEMA) throw new DiscoveryError('Use an Agent Plugins 1.0.0 plugin.json manifest.', 422);
  if (typeof manifest.name !== 'string' || manifest.name.length > 64 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(manifest.name) || /--|\.\./.test(manifest.name)) throw new DiscoveryError('The plugin manifest has an invalid name.', 422);
  const fields = ['version', 'description', 'homepage', 'repository', 'license'];
  for (const key of fields) if (manifest[key] !== undefined && typeof manifest[key] !== 'string') throw new DiscoveryError(`The plugin manifest has an invalid ${key} field.`, 422);
  if (manifest.author !== undefined) {
    const author = record(manifest.author);
    if (!author || Object.entries(author).some(([key, item]) => !['name', 'email', 'url'].includes(key) || typeof item !== 'string')) throw new DiscoveryError('The plugin manifest has an invalid author field.', 422);
  }
  if (manifest.keywords !== undefined && (!Array.isArray(manifest.keywords) || manifest.keywords.some((item) => typeof item !== 'string'))) throw new DiscoveryError('The plugin manifest has an invalid keywords field.', 422);
  const warnings: string[] = [];
  const allowed = new Set(['$schema', 'name', ...fields, 'author', 'keywords', 'extensions']);
  for (const key of Object.keys(manifest)) if (!allowed.has(key)) warnings.push(`Ignored unknown manifest field: ${key.slice(0, 100)}.`);
  const extensions = record(manifest.extensions);
  if (manifest.extensions !== undefined && !extensions) warnings.push('Ignored non-object extensions field.');
  if (extensions && Object.keys(extensions).length) warnings.push('Ignored unsupported client extension namespaces.');
  return {
    sourceUrl, name: manifest.name, version: text(manifest.version, 255), description: text(manifest.description, 4000),
    manifest: { $schema: PLUGIN_SCHEMA, name: manifest.name, ...Object.fromEntries([...fields, 'author', 'keywords'].filter((key) => manifest[key] !== undefined).map((key) => [key, manifest[key]])) },
    mode: 'metadata-preview', installable: false, validation: 'manifest-only', warnings,
    unsupportedComponents: [
      { component: 'skills', reason: 'Package directories, scripts and resources have not been fetched or validated. Skill installation is unavailable.' },
      { component: 'mcp', reason: 'Package mcp.json has not been inspected. Use a registry Streamable HTTP connection for supported MCP tools; stdio and legacy SSE are unsupported.' },
      { component: 'extensions', reason: 'Client extension data and executable hooks are unsupported.' },
    ],
  };
}

/** These handlers belong behind the existing service authentication gate. They never install or execute package content. */
export function createMarketDiscoveryRoutes(options: MarketDiscoveryOptions = {}) {
  const fetchImpl: DiscoveryFetch = options.fetchImpl ?? ((url, init) => fetch(url, init));
  return async (request: Request, url: URL): Promise<Response | null> => {
    const mcp = url.pathname === '/api/v1/market/mcp' && request.method === 'GET';
    const plugin = url.pathname === '/api/v1/market/plugins/inspect' && request.method === 'POST';
    if (!mcp && !plugin) return null;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]);
    try {
      let target: URL;
      if (mcp) {
        const search = url.searchParams.get('search') ?? '';
        const cursor = url.searchParams.get('cursor') ?? '';
        if (search.length > 200 || cursor.length > 2048) throw new DiscoveryError('The search or cursor is too long.', 400);
        target = new URL(MCP_REGISTRY_URL);
        target.searchParams.set('limit', String(PAGE_SIZE));
        target.searchParams.set('version', 'latest');
        if (search.trim()) target.searchParams.set('search', search.trim());
        if (cursor) target.searchParams.set('cursor', cursor);
      } else {
        let body: unknown;
        try { body = await readJson(request, 8192, signal); } catch { throw new DiscoveryError('Enter a plugin.json URL configured in Settings → Market.', 400); }
        const source = record(body)?.url;
        if (typeof source !== 'string' || source.length > 4096) throw new DiscoveryError('Enter a plugin.json URL configured in Settings → Market.', 400);
        try { target = new URL(source); } catch { throw new DiscoveryError('Enter an absolute HTTPS plugin.json URL.', 400); }
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
        if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && local)) || target.username || target.password || target.search || target.hash || !target.pathname.endsWith('/plugin.json')) throw new DiscoveryError('Use an HTTPS plugin.json URL, or HTTP on localhost, without credentials, query or fragment.', 400);
      }
      const response = await fetchImpl(target, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' }, signal });
      if (!response.ok) { await response.body?.cancel(); throw new DiscoveryError('The metadata source is unavailable.', 502); }
      const value = await readJson(response, mcp ? MAX_JSON_BYTES : MAX_MANIFEST_BYTES, signal);
      return json(mcp ? mcpEntries(value) : pluginPreview(value, target.href));
    } catch (error) {
      if (error instanceof DiscoveryError) return json({ error: error.message }, error.status);
      return json({ error: signal.aborted ? 'The metadata request was cancelled or timed out.' : 'The metadata source could not be read.' }, signal.aborted ? 504 : 502);
    }
  };
}
