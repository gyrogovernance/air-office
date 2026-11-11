import { bundledLemonadeCatalog } from '../packages/providers/src/providers.service.public';
/** Loopback-only development services. Unknown operations fail instead of pretending success. */
export function startDemoRuntime() {
  const models: { id: string; labels: string[]; recipe: string; size?: number; suggested?: boolean }[] = [
    { id: 'Demo-Chat', labels: ['chat'], recipe: 'llamacpp' },
    { id: 'Demo-Embedding', labels: ['embeddings'], recipe: 'llamacpp' },
    { id: 'Demo-Reranker', labels: ['reranking'], recipe: 'llamacpp' },
    ...bundledLemonadeCatalog().filter((model) => model.recipe === 'llamacpp' && (model.sizeGB ?? 0) <= 8).map((model) => ({ id: model.id, labels: model.labels, recipe: model.recipe, ...(model.sizeGB ? { size: model.sizeGB } : {}), suggested: model.suggested })),
  ];
  const installed = new Set(['Demo-Chat', 'Demo-Embedding', 'Demo-Reranker']);
  const loaded = new Set(['Demo-Chat']);
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    const body: Record<string, unknown> = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const json = (value: unknown) => Response.json(value);
    if (url.pathname === '/v1/health') return json({ status: 'ok', all_models_loaded: [...loaded].map((model_name) => ({ model_name })) });
    if (url.pathname === '/v1/system-info') return json({ demo: true, 'Processor': 'Simulated CPU', 'Physical Memory': '16 GB', devices: { cpu: { name: 'Simulated CPU', available: true }, gpu: [{ name: 'Simulated graphics', available: true, vram_gb: 8 }] }, recipes: { llamacpp: { display_name: 'Text, vision and search', backends: { cpu: { state: 'installed', devices: ['cpu'] }, metal: { state: 'unsupported', devices: [], message: 'Not available in this demo' } } } } });
    if (url.pathname.endsWith('/models')) return json({ data: models.filter((model) => url.searchParams.get('show_all') === 'true' || installed.has(model.id)).map((model) => ({ ...model, downloaded: installed.has(model.id) })) });
    if (url.pathname.endsWith('/tags')) return json({ models: models.map((model) => ({ name: model.id })) });
    if (url.pathname === '/v1/registry/search') return json({ results: models.filter((model) => model.id.toLowerCase().includes((url.searchParams.get('query') ?? '').toLowerCase())).map((model) => ({ repository_id: `demo/${model.id}`, display_name: model.id, source: 'huggingface', description: 'Demo model' })) });
    if (url.pathname === '/v1/pull/variants') return json({ checkpoint: url.searchParams.get('checkpoint'), recipe: 'llamacpp', suggested_name: 'Demo-Chat', suggested_labels: ['chat'], variants: [{ name: 'Q4_K_M', primary_file: 'demo.gguf', files: ['demo.gguf'], size_bytes: 1024 }] });
    if (['/v1/load', '/v1/unload', '/v1/delete', '/v1/pull'].includes(url.pathname) && typeof body.model_name === 'string') {
      if (url.pathname === '/v1/delete') { installed.delete(body.model_name); loaded.delete(body.model_name); }
      else if (url.pathname === '/v1/unload') loaded.delete(body.model_name);
      else { installed.add(body.model_name); if (url.pathname === '/v1/load') loaded.add(body.model_name); }
      return json({ status: 'success' });
    }
    if (url.pathname.endsWith('/files')) return json({ files: [] });
    if (url.pathname === '/v1/install/dry-run') return json({ recipe: body.recipe, backend: body.backend, supported: body.recipe === 'llamacpp' && body.backend === 'cpu', repo: 'demo/local', version: 'demo', filename: 'demo-engine.zip' });
    if (url.pathname === '/v1/install') return json({ status: 'success' });
    if (url.pathname.endsWith('/options')) return json({ saved: {}, effective: { ctx_size: 4096 }, defaults: { ctx_size: 4096 } });
    if (url.pathname === '/internal/pin') return json({ status: 'success' });
    if (url.pathname === '/v1/downloads') return json([]);
    if (url.pathname === '/v1/embeddings') {
      const texts = Array.isArray(body.input) ? body.input : [body.input];
      return json({ object: 'list', model: body.model, data: texts.map((text, index) => { const embedding = Array<number>(64).fill(0); for (const word of String(text).toLowerCase().split(/\W+/)) { let hash = 0; for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; embedding[hash % 64]! += 1; } return { index, embedding }; }) });
    }
    if (url.pathname === '/v1/rerank') return json({ object: 'list', results: (Array.isArray(body.documents) ? body.documents : []).map((_, index) => ({ index, relevance_score: 1 / (index + 1) })) });
    if (url.pathname === '/mcp') {
      // Streamable HTTP: GET 405 = no background SSE (see remote-tool-connector).
      // A 200 JSON error body here makes the SDK fail with the sanitized 502 text.
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const headers = { 'mcp-session-id': 'demo-session' };
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers });
      const result = body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'AIR demo', version: '1' } }
        : body.method === 'tools/list'
          ? { tools: [{ name: 'echo', description: 'Return demo text', inputSchema: schema, annotations: { readOnlyHint: true } }] }
          : body.method === 'tools/call'
            ? { content: [{ type: 'text', text: JSON.stringify(body.params) }], isError: false }
            : null;
      return Response.json(
        result ? { jsonrpc: '2.0', id: body.id, result } : { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unsupported demo method' } },
        { headers },
      );
    }
    if (url.pathname === '/openapi.json') return json({ openapi: '3.0.0', info: { title: 'Demo tools', version: '1' }, servers: [{ url: server.url.origin }], paths: { '/echo': { get: { operationId: 'echo', summary: 'Return demo text', parameters: [{ name: 'text', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Demo text' } } } } } });
    if (url.pathname === '/echo') return json({ text: url.searchParams.get('text'), demo: true });
    return Response.json({ error: 'This operation is not supported by the demo runtime.' }, { status: 501 });
  } });
  return server;
}
