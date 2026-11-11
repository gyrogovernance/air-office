import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { startDemoRuntime } from './demo-runtime.adapter';
import { seedDemoContent } from './demo-content.adapter';
import { watchOwner } from './dev-runtime.adapter';

/** Whether a loopback port is free, so the demo web server can claim it. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once('error', () => resolveFree(false));
    probe.once('listening', () => probe.close(() => resolveFree(true)));
    probe.listen(port, '127.0.0.1');
  });
}

const runtime = startDemoRuntime();
const root = resolve(process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? resolve(process.env.HOME ?? '.', '.local', 'share'), 'AIR Office', 'Demo');
mkdirSync(resolve(root, 'files'), { recursive: true });
const port = process.env.OFFICE_PORT ?? '4329';
const base = `http://127.0.0.1:${port}`;
const service = Bun.spawn([process.execPath, 'apps/service/src/application.entry.ts'], {
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OFFICE_'))), OFFICE_DEMO_MODE: '1', OFFICE_DEMO_EXTERNAL_SEED: '1', OFFICE_DATA_ROOT: root, OFFICE_STORAGE_CONFIG: resolve(root, 'storage-location.json'), OFFICE_RUNTIME_DIR: resolve(root, 'private', 'workspace'), OFFICE_FILES_ROOT: resolve(root, 'private', 'files'), OFFICE_PORT: port, OFFICE_CREDENTIALS: 'environment', OFFICE_KEYCHAIN_SERVICE: 'air-office/demo-provider', OFFICE_LEMONADE_BASE_ORIGIN: runtime.url.origin, OFFICE_LEMONADE_TOKEN: 'demo-local-only', OFFICE_LEMONADE_EMBEDDING_MODEL: 'Demo-Embedding', OFFICE_LEMONADE_EMBEDDING_REVISION: 'demo-v1', OFFICE_LEMONADE_EMBEDDING_DIMENSIONS: '64' },
  stdout: 'inherit', stderr: 'inherit',
});
let web: ReturnType<typeof Bun.spawn> | undefined;
async function stop() { service.kill(); web?.kill(); runtime.stop(true); await Promise.allSettled([service.exited, web?.exited]); }
process.on('SIGINT', () => { void stop().then(() => process.exit(0)); }); process.on('SIGTERM', () => { void stop().then(() => process.exit(0)); });
// When the dev supervisor (or terminal) that owns us is gone and no signal
// reached us, stop so the demo service and web server do not orphan.
watchOwner(() => { void stop().then(() => process.exit(0)); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (typeof service.exitCode === 'number') throw new Error('Demo service exited.');
    const health = await fetch(`${base}/health`).then((response) => response.json()).catch(() => null);
    if (health?.demo === true) { ready = true; break; }
    if (health?.ready) throw new Error('A normal service is using this port. Stop it or choose OFFICE_PORT before starting demo mode.');
    await Bun.sleep(100);
  }
  if (!ready) throw new Error('Demo service did not start.');
  const { token } = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } }).then((response) => response.json());
  async function call<T = Record<string, never>>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Demo setup failed: ${path} (${response.status}) ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const templates = [['Ollama', 'ollama'], ['LM Studio', 'openai-compatible'], ['llama.cpp', 'openai-compatible'], ['OpenAI', 'openai-compatible'], ['OpenAI Responses', 'openai-responses'], ['Anthropic', 'anthropic'], ['Gemini', 'gemini'], ['Azure OpenAI', 'azure-openai'], ['OpenRouter', 'openai-compatible'], ['Hugging Face', 'openai-compatible'], ['Custom endpoint', 'openai-compatible']];
  for (const [name, kind] of templates) {
    const id = `demo-${name!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await call('/api/v1/model-connections', { connection: { id, name: `${name} · Demo`, kind, baseUrl: `${runtime.url.origin}/v1`, models: ['Demo-Chat'], imageModels: [], ...(kind === 'azure-openai' ? { deployment: 'Demo-Chat', apiVersion: '2024-10-21' } : {}) } }, 'PUT');
  }
  for (const kind of ['mcp', 'openapi']) {
    const id = `demo-${kind}`;
    await call('/api/v1/tools/connections', { id, name: `${kind === 'mcp' ? 'MCP' : 'OpenAPI'} · Demo`, kind, endpoint: `${runtime.url.origin}/${kind === 'mcp' ? 'mcp' : 'openapi.json'}` });
    const result = await call<{ definitions: { id: string }[] }>(`/api/v1/tools/connections/${id}/discover`, {});
    await call(`/api/v1/tools/connections/${id}`, { enabled: true }, 'PATCH');
    for (const definition of result.definitions) await call('/api/v1/tools/enable', { id: definition.id, enabled: true });
  }
  await seedDemoContent(call);
  const seeded = await call<{ nodes: { kind: string }[] }>('/api/v1/workspace/nodes');
  if (seeded.nodes.filter((node) => node.kind === 'program').length < 2) {
    throw new Error('Demo showcase seed did not install the expected programs. Check the Demo profile and retry.');
  }
  if (!process.argv.includes('--service-only')) {
    console.info('Demo service ready with showcase content.');
    console.info('Walkthrough chrome: macOS traffic lights are mocked in this Vite session (VITE_MOCK_MACOS_CHROME). On a normal bun run dev session, open ?macos-chrome=1 instead.');
    // A silent move to another port leaves the open page on the wrong
    // service, so the demo claims its port or says which one is in the way.
    const webPort = Number(process.env.OFFICE_WEB_PORT ?? 5173);
    if (!(await portIsFree(webPort))) throw new Error(`Port ${webPort} is already in use. Stop the other AIR Office server, or set OFFICE_WEB_PORT to a free port.`);
    web = Bun.spawn([process.execPath, 'run', '--cwd', 'apps/web', 'dev', '--port', String(webPort), '--strictPort'], {
      env: { ...process.env, VITE_OFFICE_SERVICE_BASE: base, VITE_OFFICE_DEMO_SERVICE_BASE: base, VITE_OFFICE_DEMO_MODE: '1', VITE_MOCK_MACOS_CHROME: '1' },
      stdout: 'inherit',
      stderr: 'inherit',
    });
  }
  await Promise.race([service.exited, ...(web ? [web.exited] : [])]);
} finally { await stop(); }
