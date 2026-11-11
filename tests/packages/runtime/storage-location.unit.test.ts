import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareStorageLocation, requestStorageLocation, storageLocationStatus } from '../../../packages/runtime/src/storage-location.adapter';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'air-storage-test-'));
  const config = join(root, 'bootstrap', 'storage-location.json');
  const defaults = { private: join(root, 'private'), public: join(root, 'public'), models: join(root, 'models'), cache: join(root, 'cache'), workspace: join(root, 'private'), files: join(root, 'private', 'files'), localAi: join(root, 'models') };
  for (const path of [defaults.private, defaults.public, defaults.models, defaults.cache]) await mkdir(path, { recursive: true });
  return { root, config, defaults, target: join(root, 'selected'), close: () => rm(root, { recursive: true, force: true }) };
}

test('storage uses four areas and selecting another root does not copy or delete existing data', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.defaults.files), { recursive: true });
    await writeFile(join(f.defaults.files, 'note.md'), 'temporary data');
    await requestStorageLocation(f.config, f.defaults, f.target);
    const status = await storageLocationStatus(f.config, f.defaults);
    expect(status.current.private).toBe(f.defaults.private);
    expect(status.pending).toBe(f.target);
    const active = await prepareStorageLocation(f.config, f.defaults);
    expect(active.private).toBe(join(f.target, 'private'));
    expect(active.public).toBe(join(f.target, 'public'));
    expect(active.models).toBe(join(f.target, 'models'));
    expect(active.cache).toBe(join(f.target, 'cache'));
    expect(await readFile(join(f.defaults.files, 'note.md'), 'utf8')).toBe('temporary data');
    expect((await storageLocationStatus(f.config, f.defaults)).pending).toBeNull();
  } finally { await f.close(); }
});

test('an old temporary data folder is left in place when durable storage is prepared', async () => {
  const f = await fixture();
  try {
    const previous = join(f.root, '.tmp', 'data');
    await mkdir(join(f.root, 'bootstrap'), { recursive: true });
    await mkdir(join(previous, 'private'), { recursive: true });
    await writeFile(join(previous, 'private', 'keep.txt'), 'kept');
    const active = { private: join(previous, 'private'), public: join(previous, 'public'), models: join(previous, 'models'), cache: join(previous, 'cache') };
    await writeFile(f.config, JSON.stringify({ version: 2, active }));
    const prepared = await prepareStorageLocation(f.config, f.defaults);
    expect(prepared.private).toBe(f.defaults.private);
    expect(await readFile(join(previous, 'private', 'keep.txt'), 'utf8')).toBe('kept');
  } finally { await f.close(); }
});

test('a pending storage root can be cancelled without touching existing files', async () => {
  const f = await fixture();
  try {
    await requestStorageLocation(f.config, f.defaults, f.target);
    await requestStorageLocation(f.config, f.defaults, null);
    expect(await prepareStorageLocation(f.config, f.defaults)).toMatchObject({ private: f.defaults.private, models: f.defaults.models });
  } finally { await f.close(); }
});
