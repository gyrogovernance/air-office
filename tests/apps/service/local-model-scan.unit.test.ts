import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'node:path';
import { defaultModelLocations, detectEnginesInFolders, detectInstalledEngines, detectLocalEngines, scanModelLocations, createLocalModelScanStore } from '../../../apps/service/src/local-model-scan.adapter';
import { createLocalModelScanRoutes } from '../../../apps/service/src/local-model-scan.route';
import { createStorageFolderRoutes } from '../../../apps/service/src/storage-folders.route';

const gguf = Buffer.from('474755460300000000000000000000000000000000000000', 'hex');
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'air-model-scan-')); return { root, close: () => rm(root, { recursive: true, force: true }) }; }

/** A runtime that answers the model calls and reports an empty engine catalogue. */
function runtimeServer(requests: { path: string; body: unknown }[]) {
  return Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET') return Response.json({ recipes: {} });
    requests.push({ path, body: await request.json() });
    const body = requests[requests.length - 1]?.body as { model_name?: string } | undefined;
    // The runtime reports the public name and keeps the canonical one.
    const canonical = body?.model_name ?? 'user.imported-model';
    return Response.json({ model_name: canonical.replace(/^user\./, ''), canonical_model_name: canonical });
  } });
}

test('default locations include all requested apps and respect environment overrides', () => {
  const home = join(tmpdir(), 'scan-home'); const hf = join(home, 'hf-cache'); const ollama = join(home, 'ollama-cache');
  const locations = defaultModelLocations(home, { HF_HUB_CACHE: hf, OLLAMA_MODELS: ollama }, 'win32');
  for (const app of ['Ollama', 'LM Studio', 'Unsloth', 'GPT4All', 'Jan', 'Msty', 'llama.cpp']) expect(locations.some((location) => location.name.includes(app))).toBe(true);
  expect(locations.some((location) => location.path === hf)).toBe(true);
  expect(locations.some((location) => location.path === ollama)).toBe(true);
});

test('the Data models folder is always a default scan location', () => {
  const models = join(tmpdir(), 'owned-models');
  const locations = defaultModelLocations(join(tmpdir(), 'scan-home'), {}, 'win32', models);
  expect(locations[0]).toMatchObject({ name: 'AI models', path: models, extra: false });
  expect(defaultModelLocations(join(tmpdir(), 'scan-home'), {}, 'win32', 'C:\\').some((location) => location.name === 'AI models')).toBe(false);
});

test('scan finds GGUF, Ollama blobs and MLX, ignores projectors and detects missing shards', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'chat.gguf'), gguf); await writeFile(join(f.root, 'mmproj.gguf'), gguf); await writeFile(join(f.root, 'not-a-model.gguf'), 'invalid');
    await writeFile(join(f.root, 'split-00001-of-00002.gguf'), gguf);
    await mkdir(join(f.root, 'mlx-model')); await writeFile(join(f.root, 'mlx-model', 'config.json'), JSON.stringify({ model_type: 'llama', quantization: { bits: 4 } })); await writeFile(join(f.root, 'mlx-model', 'model.safetensors'), 'weights');
    const digest = 'a'.repeat(64); await mkdir(join(f.root, 'blobs')); await writeFile(join(f.root, 'blobs', 'sha256-' + digest), gguf);
    const manifest = join(f.root, 'manifests', 'registry.ollama.ai', 'library', 'bonsai'); await mkdir(manifest, { recursive: true }); await writeFile(join(manifest, 'latest'), JSON.stringify({ layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: 'sha256:' + digest }] }));
    const location = { id: 'fixture', name: 'Fixture', path: f.root, extra: false };
    const result = await scanModelLocations([location, { ...location, id: 'duplicate' }]);
    expect(result.models).toHaveLength(4);
    expect(result.models.find((model) => model.name === 'bonsai:latest')?.format).toBe('GGUF');
    expect(result.models.find((model) => model.format === 'MLX')?.issue).toContain('does not support');
    expect(result.models.find((model) => model.name.includes('split'))?.issue).toBe('Some model shards are missing.');
    expect(await readFile(join(f.root, 'chat.gguf'))).toEqual(gguf);
  } finally { await f.close(); }
});

test('selected scan folders persist and removing a folder revokes its stale import candidates', async () => {
  const f = await fixture();
  try {
    const models = join(f.root, 'models'); await mkdir(models); await writeFile(join(models, 'chat.gguf'), gguf);
    const path = join(f.root, 'state.json'); const store = createLocalModelScanStore(path, []);
    await store.add(models); await store.add(models); await store.scan(); const state = await store.status();
    expect(state.folders).toHaveLength(1); expect(state.models).toHaveLength(1);
    const restored = createLocalModelScanStore(path, []); expect((await restored.status()).models).toHaveLength(1);
    await restored.remove(state.folders[0]!.id); await expect(restored.candidate(state.models[0]!.id)).rejects.toThrow();
    expect(await readFile(join(models, 'chat.gguf'))).toEqual(gguf);
  } finally { await f.close(); }
});

test('import registers only a scanned local checkpoint and makes no download request', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    await writeFile(join(f.root, 'chat.gguf'), gguf);
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const scanned = await (await action({ action: 'scan' }))?.json();
    expect((await action({ action: 'import', id: 'not-scanned', path: join(f.root, 'arbitrary.gguf') }))?.status).toBe(400);
    const imported = await (await action({ action: 'import', id: scanned.models[0].id }))?.json();
    expect(imported.models[0].importedModel).toStartWith('imported-chat-');
    expect(requests).toHaveLength(1); expect(requests[0]?.path).toBe('/v1/models/register');
    expect(requests[0]?.body).toMatchObject({ source: 'local_path', checkpoint: scanned.models[0].path, recipe: 'llamacpp' });
    expect(await readFile(join(f.root, 'chat.gguf'))).toEqual(gguf);
  } finally { server.stop(true); await f.close(); }
});

test('deleting an imported model removes it from the runtime and the scan list', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    await writeFile(join(f.root, 'chat.gguf'), gguf);
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const scanned = await (await action({ action: 'scan' }))?.json();
    await action({ action: 'import', id: scanned.models[0].id });
    const deleted = await (await action({ action: 'delete', id: scanned.models[0].id }))?.json();
    expect(deleted.models).toHaveLength(0);
    expect(requests.map((request) => request.path)).toContain('/v1/delete');
    expect(requests.find((request) => request.path === '/v1/delete')?.body).toMatchObject({ model_name: expect.stringContaining('imported-chat-') });
    // The removal re-registers the model without a source first, so the
    // runtime drops it from its registry and keeps the files.
    const registrations = requests.filter((request) => request.path === '/v1/models/register');
    expect(registrations).toHaveLength(2);
    expect(registrations[0]?.body).toMatchObject({ source: 'local_path' });
    expect(registrations[1]?.body).not.toHaveProperty('source');
    expect(await readFile(join(f.root, 'chat.gguf'))).toEqual(gguf);
    expect((await action({ action: 'delete', id: scanned.models[0].id }))?.status).toBe(404);
  } finally { server.stop(true); await f.close(); }
});

test('an image model is registered for the image engine, not for chat', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    await writeFile(join(f.root, 'qwen-image-2_1-Q4_K_M.gguf'), gguf);
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const scanned = await (await action({ action: 'scan' }))?.json();
    expect(scanned.models[0].role).toBe('image');
    await action({ action: 'import', id: scanned.models[0].id });
    expect(requests[0]?.body).toMatchObject({ recipe: 'sd-cpp', labels: ['image'] });
  } finally { server.stop(true); await f.close(); }
});

test('a model file with a generic name takes the name of its folder', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    const folder = join(f.root, 'qwen-image-2_1-UC-Q4_K_M'); await mkdir(folder);
    await writeFile(join(folder, 'model.gguf'), gguf);
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const scanned = await (await action({ action: 'scan' }))?.json();
    await action({ action: 'import', id: scanned.models[0].id });
    expect(requests[0]?.body).toMatchObject({ model_name: expect.stringContaining('qwen-image-2_1-UC-Q4_K_M') });
  } finally { server.stop(true); await f.close(); }
});

test('a model that was never imported is removed from the list and its files are kept', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, 'chat.gguf'), gguf);
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: 'http://127.0.0.1:1', instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const scanned = await (await action({ action: 'scan' }))?.json();
    const deleted = await (await action({ action: 'delete', id: scanned.models[0].id }))?.json();
    expect(deleted.models).toHaveLength(0);
    expect(deleted.filesPreserved).toBe(true);
    expect(await readFile(join(f.root, 'chat.gguf'))).toEqual(gguf);
    // Deleting is durable: the file stays on disk but must not come back on
    // the next scan, because the user removed it deliberately.
    const rescanned = await (await action({ action: 'scan' }))?.json();
    expect(rescanned.models).toHaveLength(0);
  } finally { await f.close(); }
});

test('an engine build found by the scan can be pointed at the runtime', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    const build = join(f.root, 'build', 'bin', 'llama-server.exe');
    await mkdir(join(f.root, 'build', 'bin'), { recursive: true }); await writeFile(build, 'binary');
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    await action({ action: 'scan' });
    const state = await (await handler(new Request(url), url))?.json();
    const engine = state.engines.find((item: { kind: string }) => item.kind === 'llama.cpp');
    expect(engine).toBeDefined();
    const used = await action({ action: 'use-engine', id: engine.id, build });
    expect(used?.status).toBe(200);
    expect(requests.find((request) => request.path === '/internal/set')?.body).toEqual({ llamacpp_cpu_bin: build });
    // A path the scan did not find is refused.
    expect((await action({ action: 'use-engine', id: engine.id, build: join(f.root, 'other.exe') }))?.status).toBe(404);
  } finally { server.stop(true); await f.close(); }
});

test('the engine of a single model is chosen on that model alone', async () => {
  const f = await fixture(); const requests: { path: string; body: unknown }[] = [];
  const server = runtimeServer(requests);
  try {
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const action = (body: unknown) => handler(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
    const chosen = await action({ action: 'set-model-engine', model: 'Bonsai-1.7B-gguf', backend: 'vulkan' });
    expect(chosen?.status).toBe(200);
    expect(requests.find((request) => request.path.includes('/options'))?.body).toMatchObject({ llamacpp_backend: 'vulkan' });
  } finally { server.stop(true); await f.close(); }
});

test('models the runtime holds are reported so a downloaded model is listed', async () => {
  const f = await fixture();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'Bonsai-1.7B-gguf', labels: ['chat'], recipe: 'llamacpp', downloaded: true }] });
    return Response.json({ recipes: {} });
  } });
  try {
    const handler = createLocalModelScanRoutes(join(f.root, 'scan.json'), { baseOrigin: server.url.origin, instanceId: 'test', generation: 1, release: '2026.42.1', resolveSecret: () => 'private-runtime-key' }, true, [{ id: 'fixture', name: 'Fixture', path: f.root, extra: false }]);
    const url = new URL('http://localhost/api/v1/local-ai/model-scan');
    const state = await (await handler(new Request(url), url))?.json();
    expect(state.managedModels).toEqual([{ id: 'Bonsai-1.7B-gguf', name: 'Bonsai-1.7B-gguf', role: 'chat', recipe: 'llamacpp', backend: null }]);
  } finally { server.stop(true); await f.close(); }
});

test('engine detection reports a running local server and ignores the others', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.json({ version: '0.5.7' }); } });
  try {
    const port = server.port;
    const engines = await detectLocalEngines(undefined, [{ id: 'fixture', name: 'Fixture engine', kind: 'other', port: port!, path: '/v1/models' }]);
    expect(engines).toHaveLength(1);
    expect(engines[0]).toMatchObject({ id: 'fixture', name: 'Fixture engine', kind: 'other', version: '0.5.7', running: true, port });
    expect(engines[0]?.path).toBe(`http://127.0.0.1:${port}`);
  } finally { server.stop(true); }
  const missing = await detectLocalEngines(undefined, [{ id: 'absent', name: 'Absent engine', kind: 'other', port: 1, path: '/v1/models' }]);
  expect(missing).toEqual([]);
});

test('installed engines are found on disk even when they are not running', async () => {
  const f = await fixture();
  try {
    const folder = join(f.root, 'bin'); await mkdir(folder);
    await writeFile(join(folder, 'llama-server.exe'), 'binary');
    const engines = await detectInstalledEngines({ PATH: folder }, f.root, 'win32');
    expect(engines.some((engine) => engine.id === 'llama.cpp' && engine.path === join(folder, 'llama-server.exe') && engine.running === false)).toBe(true);
    const none = await detectInstalledEngines({ PATH: join(f.root, 'empty') }, f.root, 'win32');
    expect(none.filter((engine) => engine.id === 'llama.cpp')).toEqual([]);
  } finally { await f.close(); }
});

test('engines inside a scanned folder are reported once with their installation count', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'build-a', 'bin'), { recursive: true }); await writeFile(join(f.root, 'build-a', 'bin', 'llama-server.exe'), 'binary');
    await mkdir(join(f.root, 'build-b', 'bin'), { recursive: true }); await writeFile(join(f.root, 'build-b', 'bin', 'llama-cli.exe'), 'binary');
    const engines = await detectEnginesInFolders([{ id: 'fixture', name: 'Fixture', path: f.root, extra: true }]);
    expect(engines).toHaveLength(1);
    expect(engines[0]).toMatchObject({ name: 'llama.cpp', kind: 'llama.cpp', running: false, installed: true });
    expect(engines[0]?.path).toBe(join(f.root, 'build-a', 'bin', 'llama-server.exe'));
    expect(engines[0]?.builds).toHaveLength(2);
  } finally { await f.close(); }
});

test('folder chooser lists directories, creates a folder and rejects traversal names', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, 'Models')); await writeFile(join(f.root, 'private.txt'), 'not listed');
    const handler = createStorageFolderRoutes(f.root); const url = new URL('http://localhost/api/v1/storage-folders');
    const listing = await (await handler(new Request(url), url))?.json();
    expect(listing.folders.map((folder: { name: string }) => folder.name)).toEqual(['Models']);
    const create = (name: string) => handler(new Request(url, { method: 'POST', body: JSON.stringify({ parent: f.root, name }) }), url);
    expect((await create('../escape'))?.status).toBe(400); expect((await create('AIR data'))?.status).toBe(201);
    const next = await (await handler(new Request(url), url))?.json(); expect(next.folders.map((folder: { name: string }) => folder.name)).toEqual(['AIR data', 'Models']);
    if (process.platform === 'win32') {
      const drive = new URL(url); drive.searchParams.set('path', parse(f.root).root);
      const opened = await handler(new Request(drive), drive);
      expect(opened?.status).toBe(200);
      expect((await opened?.json()).current).toBe(parse(f.root).root);
    }
  } finally { await f.close(); }
});
