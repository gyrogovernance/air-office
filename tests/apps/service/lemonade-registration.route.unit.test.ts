import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLemonadeStatusRoutes } from '../../../apps/service/src/lemonade-status.route';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'route-instance', generation: 9, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:8000', resolveSecret: () => 'server-only-secret' };

test('registration canonicalizes a real private model directory and rejects browser paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'air-lemonade-models-'));
  const target = join(root, 'fixture');
  mkdirSync(target);
  const seen: unknown[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => { seen.push(await request.json()); return Response.json({ registered: true }); } });
  const previous = process.env.OFFICE_LEMONADE_MODELS_DIR;
  process.env.OFFICE_LEMONADE_MODELS_DIR = root;
  try {
    const route = createLemonadeStatusRoutes({ ...descriptor, baseOrigin: `http://127.0.0.1:${upstream.port}` });
    const valid = await route(new Request('http://service.test/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'register-model', input: { model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: 'fixture' } }) }), new URL('http://service.test/api/v1/local-ai/operations'));
    expect(valid?.status).toBe(200);
    expect(seen).toEqual([{ model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: await import('node:fs').then(({ realpathSync }) => realpathSync(target)) }]);
    const invalid = await route(new Request('http://service.test/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'register-model', input: { model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: 'C:\\Users\\secret' } }) }), new URL('http://service.test/api/v1/local-ai/operations'));
    expect(invalid?.status).toBe(400);
    expect(seen).toHaveLength(1);
  } finally { upstream.stop(true); rmSync(root, { recursive: true, force: true }); if (previous === undefined) delete process.env.OFFICE_LEMONADE_MODELS_DIR; else process.env.OFFICE_LEMONADE_MODELS_DIR = previous; }
});

test('registration rejects missing model directories and symlinks outside the private store', async () => {
  const root = mkdtempSync(join(tmpdir(), 'air-lemonade-models-'));
  const outside = mkdtempSync(join(tmpdir(), 'air-lemonade-outside-'));
  mkdirSync(join(outside, 'fixture'));
  symlinkSync(join(outside, 'fixture'), join(root, 'linked'), 'junction');
  const seen: unknown[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async (request) => { seen.push(await request.json()); return Response.json({ registered: true }); } });
  const previous = process.env.OFFICE_LEMONADE_MODELS_DIR;
  process.env.OFFICE_LEMONADE_MODELS_DIR = root;
  try {
    const route = createLemonadeStatusRoutes({ ...descriptor, baseOrigin: `http://127.0.0.1:${upstream.port}` });
    const request = (checkpoint: string) => route(new Request('http://service.test/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'register-model', input: { model_name: 'user.fixture', recipe: 'llamacpp', checkpoint } }) }), new URL('http://service.test/api/v1/local-ai/operations'));
    expect((await request('missing'))?.status).toBe(400);
    expect((await request('linked'))?.status).toBe(400);
    expect(seen).toHaveLength(0);
  } finally { upstream.stop(true); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); if (previous === undefined) delete process.env.OFFICE_LEMONADE_MODELS_DIR; else process.env.OFFICE_LEMONADE_MODELS_DIR = previous; }
});
