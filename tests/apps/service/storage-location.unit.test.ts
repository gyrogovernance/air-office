import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorageLocationRoutes } from '../../../apps/service/src/storage-location.route';

test('storage routes expose four areas, validate a change, cancel it and respect host control', async () => {
  const root = await mkdtemp(join(tmpdir(), 'air-storage-route-'));
  try {
    const defaults = { private: join(root, 'private'), public: join(root, 'public'), models: join(root, 'models'), cache: join(root, 'cache'), workspace: join(root, 'private'), files: join(root, 'private', 'files'), localAi: join(root, 'models') };
    const handler = createStorageLocationRoutes(join(root, 'pointer.json'), defaults, true);
    const url = new URL('http://localhost/api/v1/storage-location');
    const get = await handler(new Request(url), url);
    expect(await get?.json()).toEqual({ current: defaults, pending: null, pendingModels: null, canRelocate: true });
    await mkdir(join(root, 'cache', 'unowned-temp'), { recursive: true });
    const clearRequest = new Request(new URL('http://localhost/api/v1/data/cache'), { method: 'DELETE', body: JSON.stringify({ confirmed: true }) });
    expect(clearRequest.method).toBe('DELETE');
    const put = (destination: unknown) => new Request(url, { method: 'PUT', body: JSON.stringify({ destination }) });
    expect((await handler(put('relative'), url))?.status).toBe(400);
    expect((await (await handler(put(join(root, 'new')), url))?.json()).pending).toBe(join(root, 'new'));
    expect((await (await handler(put(null), url))?.json()).pending).toBeNull();
    const putModels = (modelsDestination: unknown) => new Request(url, { method: 'PUT', body: JSON.stringify({ modelsDestination }) });
    expect((await (await handler(putModels(join(root, 'model-drive')), url))?.json()).pendingModels).toBe(join(root, 'model-drive'));
    expect((await (await handler(putModels(null), url))?.json()).pendingModels).toBeNull();
    const attached = createStorageLocationRoutes(join(root, 'pointer.json'), defaults, false);
    expect((await attached(put(join(root, 'another')), url))?.status).toBe(409);
  } finally { await rm(root, { recursive: true, force: true }); }
});
