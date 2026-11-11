import { expect, spyOn, test } from 'bun:test';
import { createModelConnectionSettings } from '../../../packages/providers/src/model-connection-settings.service';
import type { ModelConnection } from '../../../packages/providers/src/providers.domain.public';

const connection = (): ModelConnection => ({ id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://original.example/v1', models: ['manual'], imageModels: [], observedModels: ['observed'], observedAt: '2026-01-01T00:00:00.000Z', discovery: 'success', discoveryError: null });
function fixture(initial: ModelConnection[] = [connection()]) {
  const records = new Map(initial.map((item) => [item.id, item]));
  const keys = new Map([['cloud', 'original-secret']]);
  let failWrite = false;
  let failPublication = false;
  const failedDeletes = new Set<string>();
  const settings = createModelConnectionSettings({
    store: { list: () => [...records.values()], put: (item) => { if (failPublication && item.credentialId?.startsWith('model-key-')) throw new Error('Database commit failed'); records.set(item.id, item); }, remove: (id) => records.delete(id), clearPersonalData: () => records.clear() },
    credentials: { resolve: async (id) => keys.get(id) ?? null },
    credentialStore: {
      configured: async (id) => keys.has(id),
      store: async (id, secret) => { if (failWrite) throw new Error(secret); keys.set(id, secret); },
      forget: async (id) => failedDeletes.has(id) ? 'failed' : keys.delete(id) ? 'removed' : 'absent',
      forgetAll: async () => ({ removed: 0, failed: [] as string[] })
    }, reload: () => {}
  });
  return { settings, records, keys, failedDeletes, failWrites: () => { failWrite = true; }, failPublication: () => { failPublication = true; } };
}

test('changing a target clears its observations and disconnects its old credential', async () => {
  const { settings, keys } = fixture();
  const captured = settings.get('cloud');
  const result = await settings.save({ ...captured, baseUrl: 'https://other.example/api', credentialId: 'attacker', observedModels: ['forged'] });
  expect(result.connection).toMatchObject({ baseUrl: 'https://other.example/api', models: ['manual'], observedModels: [], observedAt: null, discovery: 'unknown', credentialId: null, retiredCredentialIds: ['cloud'] });
  expect(await settings.credential(result.connection)).toBeNull();
  expect(await settings.credential(captured)).toBe('original-secret');
  expect(keys.size).toBe(1);
});

test('a failed replacement preserves the old endpoint, key and observation and owns its staged cleanup', async () => {
  const { settings, failWrites } = fixture();
  failWrites();
  await expect(settings.save({ connection: { ...connection(), baseUrl: 'https://other.example' }, secret: 'replacement-secret' })).rejects.toMatchObject({ code: 'credential-write', saved: false });
  const current = settings.get('cloud');
  expect(current.baseUrl).toBe(connection().baseUrl);
  expect(current.observedModels).toEqual(['observed']);
  expect(await settings.credential(current)).toBe('original-secret');
  expect(current.retiredCredentialIds).toHaveLength(1);
  expect(JSON.stringify(current)).not.toContain('replacement-secret');
});

test('key rotation cannot send a replacement key through an already captured endpoint', async () => {
  const { settings } = fixture();
  const captured = settings.get('cloud');
  const { connection: current } = await settings.save({ connection: { ...captured, baseUrl: 'https://other.example' }, secret: 'replacement-secret' });
  expect(await settings.credential(captured)).toBe('original-secret');
  expect(await settings.credential(current)).toBe('replacement-secret');
  expect(current.observedModels).toEqual([]);
  expect(current.retiredCredentialIds).toEqual(['cloud']);
});

test('a failed final database publication leaves the written key owned and recoverable', async () => {
  const { settings, keys, failPublication } = fixture();
  failPublication();
  await expect(settings.save({ connection: { ...connection(), baseUrl: 'https://other.example' }, secret: 'new-secret' })).rejects.toThrow('Database commit failed');
  const current = settings.get('cloud');
  expect(current.baseUrl).toBe(connection().baseUrl);
  expect(await settings.credential(current)).toBe('original-secret');
  expect(current.retiredCredentialIds).toHaveLength(1);
  expect(keys.has(current.retiredCredentialIds![0]!)).toBe(true);
  await settings.forget('cloud');
  expect(keys.size).toBe(0);
});

test('a new connection cannot forge service observations or borrow another key slot', async () => {
  const { settings } = fixture([]);
  const { connection: current } = await settings.save({ ...connection(), credentialId: 'cloud', retiredCredentialIds: ['foreign'], revision: 'spoof' });
  expect(current).toMatchObject({ credentialId: null, retiredCredentialIds: [], observedModels: [], observedAt: null, discovery: 'unknown' });
  expect(current.revision).not.toBe('spoof');
  expect(await settings.credential(current)).toBeNull();
});

test('partial cleanup retains the failed key reference and a retry removes the connection', async () => {
  const { settings, keys, failedDeletes, records } = fixture();
  await settings.save({ connection: connection(), secret: 'replacement' });
  failedDeletes.add('cloud');
  await expect(settings.remove('cloud')).rejects.toMatchObject({ code: 'credential-delete' });
  expect(settings.get('cloud')).toMatchObject({ credentialId: null, retiredCredentialIds: ['cloud'] });
  expect(keys.size).toBe(1);
  failedDeletes.clear();
  await settings.remove('cloud');
  expect(records.size).toBe(0);
  expect(keys.size).toBe(0);
});

test('removing an active credential invalidates observations from its authenticated listing', async () => {
  const { settings } = fixture();
  await settings.forget('cloud');
  expect(settings.get('cloud')).toMatchObject({ credentialId: null, observedModels: [], observedAt: null, discovery: 'unknown' });
});

test('advanced routing edits invalidate observations while retaining the credential on the same destination', async () => {
  const { settings } = fixture();
  const { connection: current } = await settings.save({ ...connection(), headers: { 'x-organization': 'different-team' } });
  expect(current).toMatchObject({ discovery: 'unknown', observedModels: [], observedAt: null });
  expect(await settings.credential(current)).toBe('original-secret');
});

test('a late discovery cannot overwrite edited settings or resurrect a deleted connection', async () => {
  const { settings, records } = fixture();
  let release: (response: Response) => void = () => {};
  let started: () => void = () => {};
  let ready = new Promise<void>((resolve) => { started = resolve; });
  const mocked = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(() => { started(); return new Promise<Response>((resolve) => { release = resolve; }); }, { preconnect: fetch.preconnect }));
  try {
    const discovering = settings.discover('cloud');
    const rejected = discovering.catch((error: unknown) => error);
    await ready;
    await settings.save({ ...connection(), models: ['new-manual'] });
    release(Response.json({ data: [{ id: 'late' }] }));
    expect(await rejected).toMatchObject({ code: 'conflict' });
    expect(settings.get('cloud').models).toEqual(['new-manual']);
    expect(settings.get('cloud').observedModels).toEqual(['observed']);

    ready = new Promise<void>((resolve) => { started = resolve; });
    const deletingDiscovery = settings.discover('cloud');
    const deleted = deletingDiscovery.catch((error: unknown) => error);
    await ready;
    await settings.remove('cloud');
    release(Response.json({ data: [{ id: 'resurrected' }] }));
    expect(await deleted).toMatchObject({ code: 'conflict' });
    expect(records.size).toBe(0);
  } finally { mocked.mockRestore(); }
});

test('overlapping discoveries publish only the most recently started attempt', async () => {
  const { settings } = fixture();
  const responses: ((value: Response) => void)[] = [];
  const mocked = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(() => new Promise<Response>((resolve) => { responses.push(resolve); }), { preconnect: fetch.preconnect }));
  try {
    const first = settings.discover('cloud');
    const firstRejected = first.catch((error: unknown) => error);
    const second = settings.discover('cloud');
    while (responses.length < 2) await Bun.sleep(1);
    responses[1]!(Response.json({ data: [{ id: 'newest' }] }));
    await second;
    responses[0]!(Response.json({ data: [{ id: 'older' }] }));
    expect(await firstRejected).toMatchObject({ code: 'conflict' });
    expect(settings.get('cloud').observedModels).toEqual(['newest']);
  } finally { mocked.mockRestore(); }
});
