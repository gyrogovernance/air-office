import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { startDemoRuntime } from './demo-runtime.adapter';
import { seedDemoContent } from './demo-content.adapter';

/**
 * Boots an isolated Demo service, seeds showcase content, and writes a JSON
 * snapshot the static GitHub Pages client can serve without any local process.
 */

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not reserve a loopback port.'));
        return;
      }
      const port = address.port;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitHealth(base: string, service: ReturnType<typeof Bun.spawn>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (typeof service.exitCode === 'number') throw new Error('Demo service exited before it was ready.');
    const health = await fetch(`${base}/health`).then((response) => response.json()).catch(() => null) as { ready?: boolean; demo?: boolean } | null;
    if (health?.demo === true && health.ready === true) return;
    await Bun.sleep(100);
  }
  throw new Error('Demo service did not become ready for the static snapshot export.');
}

const root = resolve(process.cwd(), '.tmp', 'static-demo-export');
rmSync(root, { recursive: true, force: true });
mkdirSync(resolve(root, 'files'), { recursive: true });
mkdirSync(resolve(root, 'private', 'workspace'), { recursive: true });
mkdirSync(resolve(root, 'private', 'files'), { recursive: true });

const runtime = startDemoRuntime();
const port = String(await freePort());
const base = `http://127.0.0.1:${port}`;
const service = Bun.spawn([process.execPath, 'apps/service/src/application.entry.ts'], {
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OFFICE_'))),
    OFFICE_DEMO_MODE: '1',
    OFFICE_DEMO_EXTERNAL_SEED: '1',
    OFFICE_DATA_ROOT: root,
    OFFICE_STORAGE_CONFIG: resolve(root, 'storage-location.json'),
    OFFICE_RUNTIME_DIR: resolve(root, 'private', 'workspace'),
    OFFICE_FILES_ROOT: resolve(root, 'private', 'files'),
    OFFICE_PORT: port,
    OFFICE_CREDENTIALS: 'environment',
    OFFICE_KEYCHAIN_SERVICE: 'air-office/static-demo-export',
    OFFICE_LEMONADE_BASE_ORIGIN: runtime.url.origin,
    OFFICE_LEMONADE_TOKEN: 'demo-local-only',
    OFFICE_LEMONADE_EMBEDDING_MODEL: 'Demo-Embedding',
    OFFICE_LEMONADE_EMBEDDING_REVISION: 'demo-v1',
    OFFICE_LEMONADE_EMBEDDING_DIMENSIONS: '64',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

async function stop(): Promise<void> {
  service.kill();
  runtime.stop(true);
  await Promise.allSettled([service.exited]);
  rmSync(root, { recursive: true, force: true });
}

process.on('SIGINT', () => { void stop().then(() => process.exit(1)); });
process.on('SIGTERM', () => { void stop().then(() => process.exit(1)); });

try {
  await waitHealth(base, service);
  const { token } = await fetch(`${base}/bootstrap`, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173' },
  }).then((response) => response.json()) as { token: string };

  async function call<T = unknown>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Static demo export failed: ${method} ${path} (${response.status}) ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const templates = [
    ['Ollama', 'ollama'],
    ['LM Studio', 'openai-compatible'],
    ['llama.cpp', 'openai-compatible'],
    ['OpenAI', 'openai-compatible'],
    ['OpenAI Responses', 'openai-responses'],
    ['Anthropic', 'anthropic'],
    ['Gemini', 'gemini'],
    ['Azure OpenAI', 'azure-openai'],
    ['OpenRouter', 'openai-compatible'],
    ['Hugging Face', 'openai-compatible'],
    ['Custom endpoint', 'openai-compatible'],
  ] as const;
  for (const [name, kind] of templates) {
    const id = `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await call('/api/v1/model-connections', {
      connection: {
        id,
        name: `${name} · Demo`,
        kind,
        baseUrl: `${runtime.url.origin}/v1`,
        models: ['Demo-Chat'],
        imageModels: [],
        ...(kind === 'azure-openai' ? { deployment: 'Demo-Chat', apiVersion: '2024-10-21' } : {}),
      },
    }, 'PUT');
  }
  for (const kind of ['mcp', 'openapi'] as const) {
    const id = `demo-${kind}`;
    await call('/api/v1/tools/connections', {
      id,
      name: `${kind === 'mcp' ? 'MCP' : 'OpenAPI'} · Demo`,
      kind,
      endpoint: `${runtime.url.origin}/${kind === 'mcp' ? 'mcp' : 'openapi.json'}`,
    });
    const result = await call<{ definitions: { id: string }[] }>(`/api/v1/tools/connections/${id}/discover`, {});
    await call(`/api/v1/tools/connections/${id}`, { enabled: true }, 'PATCH');
    for (const definition of result.definitions) await call('/api/v1/tools/enable', { id: definition.id, enabled: true });
  }
  await seedDemoContent(call);

  const health = await fetch(`${base}/health`).then((response) => response.json());
  const bootstrap = await call('/api/v1/bootstrap');
  const nodes = await call<{ nodes: { id: string; kind: string; targetId?: string }[] }>('/api/v1/workspace/nodes');
  const documentsList = await call<{ documents: { id: string; path?: string }[] }>('/api/v1/rich-documents');
  const trash = await call('/api/v1/rich-documents/trash');
  const conversations = await call<{ conversations: { id: string }[] }>('/api/v1/conversations?limit=1000&archived=include');
  const folders = await call('/api/v1/folders');
  const methods = await call('/api/v1/methods');
  const automations = await call('/api/v1/automations');
  const calendarLists = await call('/api/v1/calendar/lists');
  const calendarEvents = await call('/api/v1/calendar/events');
  const labApps = await call('/api/v1/lab/apps');
  const labGlossary = await call('/api/v1/lab/glossary').catch(() => ({ entries: [] }));
  const providers = await call('/api/v1/providers');
  const tools = await call('/api/v1/tools');
  const externalRoots = await call('/api/v1/external/roots');
  const modelConnections = await call('/api/v1/model-connections');
  const modelCatalog = await call('/api/v1/model-catalog').catch(() => ({ models: [] }));
  const capabilities = await call('/api/v1/capabilities').catch(() => ({}));
  const quickStart = await call('/api/v1/quick-start').catch(() => ({}));
  const crafts = await call('/api/v1/crafts').catch(() => ({ crafts: [] }));
  const collections = await call('/api/v1/collections').catch(() => ({ collections: [] }));
  const marketCatalog = await call('/api/v1/market/catalog').catch(() => ({ items: [] }));
  const marketSources = await call('/api/v1/market/sources').catch(() => ({ sources: [] }));
  const memory = await call('/api/v1/memory').catch(() => ({ items: [] }));
  const storageLocation = await call('/api/v1/storage-location').catch(() => ({}));
  const workspaceDefaults = await call('/api/v1/workspace-defaults').catch(() => ({}));
  const localAiStatus = await call('/api/v1/local-ai/status').catch(() => ({ state: 'unavailable' }));
  const chatgptStatus = await call('/api/v1/cloud/chatgpt/status').catch(() => ({ accounts: [] }));

  const documentsByKey: Record<string, unknown> = {};
  for (const document of documentsList.documents) {
    const full = await call<{ document: { id: string; path?: string } }>(`/api/v1/rich-documents/${encodeURIComponent(document.id)}`);
    documentsByKey[document.id] = full;
    if (document.path) documentsByKey[document.path] = full;
    if (full.document.path && full.document.path !== document.path) documentsByKey[full.document.path] = full;
  }

  const conversationsById: Record<string, unknown> = {};
  const conversationHistoryById: Record<string, unknown> = {};
  for (const summary of conversations.conversations) {
    const graph = await call(`/api/v1/conversations/${encodeURIComponent(summary.id)}`);
    conversationsById[summary.id] = graph;
    const history = await call(`/api/v1/conversations/${encodeURIComponent(summary.id)}/history?limit=200&from=end`);
    conversationHistoryById[summary.id] = history;
  }

  const scopeMaterial: Record<string, unknown> = {};
  for (const node of nodes.nodes) {
    if (node.kind !== 'program' && node.kind !== 'project') continue;
    scopeMaterial[node.id] = await call(`/api/v1/workspace/scopes/${encodeURIComponent(node.id)}/material`).catch(() => ({
      name: '',
      instruction: '',
      sources: [],
    }));
  }

  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    health,
    bootstrap,
    routes: {
      'GET /api/v1/bootstrap': bootstrap,
      'GET /api/v1/workspace/nodes': nodes,
      'GET /api/v1/rich-documents': documentsList,
      'GET /api/v1/rich-documents/trash': trash,
      'GET /api/v1/conversations': conversations,
      'GET /api/v1/folders': folders,
      'GET /api/v1/methods': methods,
      'GET /api/v1/automations': automations,
      'GET /api/v1/calendar/lists': calendarLists,
      'GET /api/v1/calendar/events': calendarEvents,
      'GET /api/v1/lab/apps': labApps,
      'GET /api/v1/lab/glossary': labGlossary,
      'GET /api/v1/providers': providers,
      'GET /api/v1/tools': tools,
      'GET /api/v1/external/roots': externalRoots,
      'GET /api/v1/model-connections': modelConnections,
      'GET /api/v1/model-catalog': modelCatalog,
      'GET /api/v1/capabilities': capabilities,
      'GET /api/v1/quick-start': quickStart,
      'GET /api/v1/crafts': crafts,
      'GET /api/v1/collections': collections,
      'GET /api/v1/market/catalog': marketCatalog,
      'GET /api/v1/market/sources': marketSources,
      'GET /api/v1/memory': memory,
      'GET /api/v1/storage-location': storageLocation,
      'GET /api/v1/workspace-defaults': workspaceDefaults,
      'GET /api/v1/local-ai/status': localAiStatus,
      'GET /api/v1/cloud/chatgpt/status': chatgptStatus,
    } as Record<string, unknown>,
    documentsByKey,
    conversationsById,
    conversationHistoryById,
    scopeMaterial,
  };

  const outDir = resolve(process.cwd(), 'apps/web/src/static-demo');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'demo-snapshot.json');
  writeFileSync(outFile, `${JSON.stringify(snapshot)}\n`);
  console.info(`Wrote static demo snapshot (${nodes.nodes.length} workspace nodes) to ${outFile}`);
} finally {
  await stop();
}
