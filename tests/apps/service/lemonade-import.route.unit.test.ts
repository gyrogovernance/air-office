import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, realpath, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLemonadeImportRoutes } from '../../../apps/service/src/lemonade-import.route';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

const id = 'a'.repeat(64);
async function fixture(run: (context: { route: ReturnType<typeof createLemonadeImportRoutes>; calls: { path: string; body: unknown }[]; root: string; external: string; privateRoot: string; record: string; file: string; setFiles: (files: unknown[]) => void; setStore: (path: string) => void }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'air-import-'));
  const privateRoot = join(root, 'private'); const external = join(root, 'external'); const record = join(root, 'authorization.json');
  await mkdir(privateRoot); await mkdir(external);
  const file = join(external, 'split-00001-of-00002.gguf'); await writeFile(file, 'external fixture'); await writeFile(join(external, 'split-00002-of-00002.gguf'), 'second shard');
  await writeFile(record, JSON.stringify({ id, path: await realpath(external) }));
  let externalDir = '';
  let files: unknown[] = [{ path: file, exists: true }]; let modelsDir = privateRoot;
  const calls: { path: string; body: unknown }[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => {
    expect(request.headers.get('authorization')).toBe('Bearer private-token');
    const url = new URL(request.url); calls.push({ path: url.pathname + url.search, body: request.method === 'POST' ? await request.json() : null });
    if (url.pathname === '/internal/config') return Response.json({ models_dir: modelsDir, extra_models_dir: externalDir });
    if (url.pathname === '/internal/set' && request.method === 'POST') { externalDir = String((calls.at(-1)?.body as { extra_models_dir?: string }).extra_models_dir ?? externalDir); }
    if (url.pathname.endsWith('/files')) return Response.json({ files });
    return Response.json({ status: 'success' });
  } });
  const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'fixture', generation: 1, release: '2026.42.1', baseOrigin: `http://127.0.0.1:${upstream.port}`, resolveSecret: () => 'private-token' };
  const route = createLemonadeImportRoutes(descriptor, { authorizationPath: record, privateModelsDirectory: privateRoot }, async () => Response.json({ forwarded: true }));
  try { await run({ route, calls, root, external, privateRoot, record, file, setFiles: (value) => { files = value; }, setStore: (value) => { modelsDir = value; } }); }
  finally { upstream.stop(true); await rm(root, { recursive: true, force: true }); }
}
function post(route: ReturnType<typeof createLemonadeImportRoutes>, body: unknown, path = '/api/v1/local-ai/import-folder') {
  const url = new URL(`http://service.test${path}`);
  return route(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url);
}
const operation = (route: ReturnType<typeof createLemonadeImportRoutes>, body: unknown) => post(route, body, '/api/v1/local-ai/operations');

test('authorized opaque selection configures extra_models_dir without moving split GGUF files or exposing paths', () => fixture(async ({ route, calls, external, file }) => {
  const response = await post(route, { id });
  expect(response?.status).toBe(200);
  expect(await response!.json()).toEqual({ imported: true, ownership: 'external', deletionAllowed: false });
  expect(calls).toEqual([{ path: '/internal/set', body: { extra_models_dir: await realpath(external) } }]);
  expect(await readFile(file, 'utf8')).toBe('external fixture');
}));

test('browser paths, forged and replaced selections, missing authorization fail closed', () => fixture(async ({ route, calls, record }) => {
  for (const body of [{ path: 'C:\\models' }, { id: 'b'.repeat(64) }, { id, path: 'C:\\models' }]) expect((await post(route, body))?.status).toBe(403);
  await rm(record);
  expect((await post(route, { id }))?.status).toBe(400);
  expect(calls).toHaveLength(0);
}));

test('external deletion and direct storage or path-disclosure operations are denied', () => fixture(async ({ route, calls, file }) => {
  expect((await operation(route, { operation: 'delete', input: { model_name: 'split' } }))?.status).toBe(403);
  for (const body of [{ operation: 'set-config', input: { key: 'extra_models_dir', value: 'C:\\models' } }, { operation: 'set-config', input: { key: 'models_dir', value: 'auto' } }, { operation: 'cleanup-cache' }, { operation: 'model-files', model: 'split', includePaths: true }]) expect((await operation(route, body))?.status).toBe(403);
  expect(calls.some((call) => call.path === '/v1/delete')).toBe(false);
  expect(await readFile(file, 'utf8')).toBe('external fixture');
}));

test('private deletion requires canonical file ownership and rejects escaped junctions, missing files, and shared cache', () => fixture(async ({ route, privateRoot, external, calls, setFiles, setStore }) => {
  const owned = join(privateRoot, 'owned.gguf'); await writeFile(owned, 'owned');
  setFiles([{ path: owned }]);
  expect((await operation(route, { operation: 'delete', input: { model_name: 'owned' } }))?.status).toBe(200);
  expect(calls.filter((call) => call.path === '/v1/delete')).toHaveLength(1);
  const linked = join(privateRoot, 'linked'); await symlink(external, linked, 'junction');
  setFiles([{ path: join(linked, 'split-00001-of-00002.gguf') }]);
  expect((await operation(route, { operation: 'delete', input: { model_name: 'linked' } }))?.status).toBe(403);
  setFiles([{ path: join(privateRoot, 'missing.gguf') }]);
  expect((await operation(route, { operation: 'delete', input: { model_name: 'missing' } }))?.status).toBe(400);
  setStore('auto'); setFiles([{ path: owned }]);
  expect((await operation(route, { operation: 'delete', input: { model_name: 'shared' } }))?.status).toBe(403);
  expect(calls.filter((call) => call.path === '/v1/delete')).toHaveLength(1);
}));

test('unrelated operations retain the existing management route', () => fixture(async ({ route, calls }) => {
  expect(await (await operation(route, { operation: 'health' }))!.json()).toEqual({ forwarded: true });
  expect(calls).toHaveLength(0);
}));


test('authorized folder display and disconnect preserve original external files', () => fixture(async ({ route, external, file }) => {
  expect((await post(route, { id }))?.status).toBe(200);
  const url = new URL('http://service.test/api/v1/local-ai/import-folder');
  const connected = await route(new Request(url), url);
  expect(await connected?.json()).toEqual({ connected: true, label: 'external', deletionAllowed: false });
  const disconnected = await route(new Request(url, { method: 'DELETE' }), url);
  expect(await disconnected?.json()).toEqual({ connected: false, filesPreserved: true });
  expect(await readFile(file, 'utf8')).toBe('external fixture');
  expect(await readFile(join(external, 'split-00002-of-00002.gguf'), 'utf8')).toBe('second shard');
  expect(await (await route(new Request(url), url))?.json()).toEqual({ connected: false });
}));
