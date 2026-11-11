import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { isAbsolute, join, resolve, dirname } from 'node:path';

type StorageRecord = { version: 2; active: { private: string; public: string; models: string; cache: string }; pending?: string; pendingModels?: string };
export type StorageLayout = { private?: string; public?: string; models?: string; cache?: string; workspace: string; files: string; localAi: string };
export type StorageLocationStatus = { current: StorageLayout; pending: string | null; pendingModels: string | null };
function areas(root: string) { return { private: join(root, 'private'), public: join(root, 'public'), models: join(root, 'models'), cache: join(root, 'cache') }; }
function currentLayout(root: string): StorageLayout {
  const base = areas(root);
  return { ...base, workspace: base.private, files: join(base.private, 'files'), localAi: base.models };
}
function legacyTemporaryStorage(path: string): boolean {
  const value = resolve(path).replaceAll('\\', '/').toLowerCase();
  return ['/.tmp/data', '/.tmp/dev-local-ai', '/.tmp/demo-runtime', '/.tmp/demo'].some((marker) => value.includes(marker));
}
function legacyAreas(value: StorageLayout, defaults: StorageLayout): StorageRecord['active'] {
  if (value.private && value.public && value.models && value.cache) return { private: value.private, public: value.public, models: value.models, cache: value.cache };
  const root = defaults.private ? dirname(defaults.private) : resolve(value.workspace, '..', '..');
  const base = areas(root);
  return { private: value.private ?? base.private, public: value.public ?? base.public, models: value.models ?? value.localAi ?? base.models, cache: value.cache ?? base.cache };
}
function withLegacyPaths(active: StorageRecord['active']): StorageLayout {
  return { ...active, workspace: active.private, files: join(active.private, 'files'), localAi: active.models };
}
async function load(config: string, defaults: StorageLayout): Promise<StorageRecord> {
  try {
    const value: unknown = JSON.parse(await readFile(config, 'utf8'));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2 || !('active' in value) || !value.active || typeof value.active !== 'object') throw new Error();
    const active = value.active as Record<string, unknown>;
    if (!['private', 'public', 'models', 'cache'].every((key) => typeof active[key] === 'string' && isAbsolute(active[key] as string))) throw new Error();
    if ('pending' in value && typeof value.pending !== 'string') throw new Error();
    if ('pendingModels' in value && typeof value.pendingModels !== 'string') throw new Error();
    return { version: 2, active: { private: active.private as string, public: active.public as string, models: active.models as string, cache: active.cache as string }, ...('pending' in value && typeof value.pending === 'string' ? { pending: value.pending } : {}), ...('pendingModels' in value && typeof value.pendingModels === 'string' ? { pendingModels: value.pendingModels } : {}) };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { version: 2, active: legacyAreas(defaults, defaults) };
    throw new Error('Storage settings are invalid. Restart with the clean storage layout or remove the old storage-location settings.');
  }
}
async function save(config: string, record: StorageRecord) {
  await mkdir(dirname(config), { recursive: true });
  const temporary = `${config}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  await rename(temporary, config);
}
export async function storageLocationStatus(config: string, defaults: StorageLayout): Promise<StorageLocationStatus> {
  const record = await load(config, defaults);
  return { current: withLegacyPaths(record.active), pending: record.pending ?? null, pendingModels: record.pendingModels ?? null };
}
export async function requestStorageLocation(config: string, defaults: StorageLayout, destination?: string | null, modelsDestination?: string | null) {
  const record = await load(config, defaults);
  if (destination !== undefined) {
    if (destination === null) { delete record.pending; } else {
      if (!isAbsolute(destination) || destination.includes('\0')) throw new Error('Choose an absolute folder path.');
      record.pending = resolve(destination);
    }
  }
  if (modelsDestination !== undefined) {
    if (modelsDestination === null) { delete record.pendingModels; } else {
      if (!isAbsolute(modelsDestination) || modelsDestination.includes('\0')) throw new Error('Choose an absolute folder path.');
      record.pendingModels = resolve(modelsDestination);
    }
  }
  await save(config, record);
}
/** New installs use the four-area layout directly. Changing roots does not copy or delete existing data. */
export async function prepareStorageLocation(config: string, defaults: StorageLayout): Promise<StorageLayout> {
  const record = await load(config, defaults);
  if (defaults.private && legacyTemporaryStorage(record.active.private) && !legacyTemporaryStorage(defaults.private)) {
    record.active = { private: defaults.private, public: defaults.public!, models: defaults.models!, cache: defaults.cache! };
    delete record.pending;
    delete record.pendingModels;
    await save(config, record);
  }
  if (record.pending) {
    const root = record.pending;
    record.active = { ...areas(root), models: record.pendingModels ?? areas(root).models };
    delete record.pending;
    delete record.pendingModels;
    await save(config, record);
  } else if (record.pendingModels) {
    record.active = { ...record.active, models: record.pendingModels };
    delete record.pendingModels;
    await save(config, record);
  }
  const active = withLegacyPaths(record.active);
  await Promise.all([active.private!, active.public!, active.models!, active.cache!].map((path) => mkdir(path, { recursive: true })));
  return active;
}
