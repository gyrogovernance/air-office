import { expect, test } from 'bun:test';
import { LemonadeManagementAdapter, LemonadeStatusError, runLemonadeOperation, validateOwnedModelRegistration, ownedModelRegistrationPath, type LemonadeRuntimeDescriptor } from '../../../packages/providers/src/lemonade-status.adapter';

const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'fixture', generation: 3, release: '2026.42.1', baseOrigin: 'http://lemonade.test:13305', resolveSecret: () => 'private-key' };

test('owned model registration rejects paths and builds only a private child path', () => {
  expect(validateOwnedModelRegistration({ model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: 'fixture' })).toBe(true);
  expect(validateOwnedModelRegistration({ model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: 'C:\\Users\\secret' })).toBe(false);
  expect(validateOwnedModelRegistration({ model_name: 'user.fixture', recipe: 'llamacpp', checkpoint: '../secret' })).toBe(false);
  expect(ownedModelRegistrationPath('fixture', 'C:\\AIR\\models')).toBe('C:\\AIR\\models/fixture');
  expect(ownedModelRegistrationPath('fixture', 'C:\\AIR\\models' + '/'.repeat(100_000))).toBe('C:\\AIR\\models/fixture');
});

test('typed management operations use source-pinned endpoints and payloads', async () => {
  const seen: { url: URL; method: string; body: unknown }[] = [];
  const adapter = new LemonadeManagementAdapter(descriptor, { request: async (input, init) => {
    seen.push({ url: new URL(String(input)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ ok: true });
  } });
  await adapter.dryRunInstall({ recipe: 'llamacpp', backend: 'vulkan' });
  await adapter.getVariants('org/model-gguf');
  await adapter.searchRegistry({ query: 'qwen', source: 'huggingface', limit: 10, format: 'gguf' });
  await adapter.controlDownload({ id: 'model:small', action: 'pause' });
  await adapter.pull({ model_name: 'small', stream: true, subscribe: false });
  await runLemonadeOperation(adapter, { operation: 'install', input: { recipe: 'llamacpp', backend: 'cpu' } });
  await adapter.addAlias({ alias: 'chat.default', model_name: 'small' });
  await adapter.removeAlias('chat.default');
  await adapter.checkUpdates();
  await adapter.validateRouting({ policy: { recipe: 'collection.router' }, has_images: true, has_tools: false, metadata: { team: 'ops' } });
  await adapter.createJob({ name: 'Benchmark trial', definition: { steps: [] }, inputs: {} });
  await adapter.controlJob('job-1', 'pause');
  expect(seen.map(({ url, method, body }) => [url.pathname, method, Object.fromEntries(url.searchParams), body])).toEqual([
    ['/v1/install/dry-run', 'POST', {}, { recipe: 'llamacpp', backend: 'vulkan' }],
    ['/v1/pull/variants', 'GET', { checkpoint: 'org/model-gguf' }, undefined],
    ['/v1/registry/search', 'GET', { query: 'qwen', source: 'huggingface', limit: '10', format: 'gguf' }, undefined],
    ['/v1/downloads/control', 'POST', {}, { id: 'model:small', action: 'pause' }],
    ['/v1/pull', 'POST', {}, { model_name: 'small', stream: true, subscribe: false }],
    ['/v1/install', 'POST', {}, { recipe: 'llamacpp', backend: 'cpu' }],
    ['/internal/aliases', 'POST', {}, { alias: 'chat.default', model_name: 'small' }],
    ['/internal/aliases/chat.default', 'DELETE', {}, undefined],
    ['/v1/models/check-updates', 'POST', {}, {}],
    ['/v1/routing/validate', 'POST', {}, { policy: { recipe: 'collection.router' }, has_images: true, has_tools: false, metadata: { team: 'ops' } }],
    ['/v1/jobs', 'POST', {}, { name: 'Benchmark trial', definition: { steps: [] }, inputs: {} }],
    ['/v1/jobs/job-1/pause', 'POST', {}, {}]
  ]);
});

test('management inputs reject malformed routing, aliases, jobs, and non-finite options before transport', async () => {
  const adapter = new LemonadeManagementAdapter(descriptor, { request: async () => Response.json({ ok: true }) });
  for (const action of [
    () => Promise.resolve().then(() => adapter.validateRouting({ policy: {}, metadata: { team: 3 } as unknown as Record<string, string> })),
    () => Promise.resolve().then(() => adapter.validateRouting({ policy: {}, has_images: 'yes' as unknown as boolean })),
    () => Promise.resolve().then(() => adapter.addAlias({ alias: '../chat', model_name: 'fixture' })),
    () => Promise.resolve().then(() => adapter.removeAlias('bad alias')),
    () => Promise.resolve().then(() => adapter.saveModelOptions('fixture', { temperature: Number.NaN })),
    () => Promise.resolve().then(() => adapter.createJob({ name: 'bad job', definition: 'invalid' as unknown as Record<string, unknown> })),
  ]) await expect(action()).rejects.toMatchObject({ code: 'invalid-request' });
});

test('safe config preserves pinned ranges and rejects privileged or unknown settings before transport', async () => {
  const sent: unknown[] = [];
  const adapter = new LemonadeManagementAdapter(descriptor, { request: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return Response.json({ ok: true }); } });
  const allowed = [
    ['ctx_size', -1], ['ctx_size', 0], ['ctx_size', 8192], ['max_loaded_models', -1], ['max_loaded_models', 3],
    ['global_timeout', 600], ['auto_evict', true], ['auto_evict_threshold_pct', 1], ['auto_evict_threshold_pct', 0.9],
    ['log_level', 'warning'], ['log_max_file_size_mb', 2048], ['log_max_files', 0], ['log_max_files', 100],
    ['inhibit_suspend', false], ['disable_model_filtering', true], ['enable_dgpu_gtt', false],
  ] as const;
  for (const [key, value] of allowed) await runLemonadeOperation(adapter, { operation: 'set-config', input: { key, value } });
  expect(sent).toEqual(allowed.map(([key, value]) => ({ [key]: value })));
  const forbidden: [string, unknown][] = [
    ['ctx_size', -2], ['ctx_size', 1.5], ['ctx_size', 2_147_483_648], ['ctx_size', '8192'],
    ['max_loaded_models', 0], ['max_loaded_models', -2], ['global_timeout', 0],
    ['auto_evict', 'true'], ['auto_evict_threshold_pct', 0], ['auto_evict_threshold_pct', 1.01], ['auto_evict_threshold_pct', NaN],
    ['log_level', 'warn'], ['log_max_files', 101], ['log_max_file_size_mb', 0], ['log_max_file_size_mb', 2049],
    ['host', '0.0.0.0'], ['port', 80], ['websocket_port', 80], ['allowed_origins', '*'], ['broadcast', true],
    ['models_dir', '/shared'], ['log_file', '/secret'], ['llamacpp_args', '--model /secret'], ['llamacpp', { cpu_bin: '/tmp/bin' }],
    ['telemetry', { enabled: true, otlp: { headers: { authorization: 'secret' } } }], ['cloud', { enabled: true }],
    ['cloud.enabled', true], ['api_key', 'secret'], ['invented_setting', 1], ['__proto__', {}],
  ];
  for (const [key, value] of forbidden) expect(() => adapter.setConfig({ key, value })).toThrow(LemonadeStatusError);
  for (const input of [null, [], {}, { key: 'ctx_size' }]) expect(() => adapter.setConfig(input as never)).toThrow(LemonadeStatusError);
  expect(sent).toHaveLength(allowed.length);
  await adapter.setConfig({ key: 'extra_models_dir', value: 'C:\\AIR\\authorized-models' });
  expect(sent.at(-1)).toEqual({ extra_models_dir: 'C:\\AIR\\authorized-models' });
  await expect(runLemonadeOperation(adapter, { operation: 'set-config', input: { key: 'extra_models_dir', value: '/browser' } })).rejects.toMatchObject({ code: 'invalid-request' });
  expect(() => adapter.setConfig({ key: 'extra_models_dir', value: '/bad\0path' })).toThrow(LemonadeStatusError);
  expect(sent).toHaveLength(allowed.length + 1);
});

test('job and slot controls enforce runtime enums and safe bounded cache basenames', async () => {
  const sent: { path: string; query: string; body: unknown }[] = [];
  const adapter = new LemonadeManagementAdapter(descriptor, { request: async (url, init) => {
    const parsed = new URL(String(url)); sent.push({ path: parsed.pathname, query: parsed.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ ok: true });
  } });
  for (const action of ['pause', 'interrupt', 'resume'] as const) await adapter.controlJob('job-1', action);
  await adapter.controlSlot(0, 'save', { filename: 'cache-1.bin' });
  await adapter.controlSlot(1, 'restore', { filename: 'a'.repeat(120) });
  await adapter.controlSlot(2, 'erase');
  expect(sent).toEqual([
    ...['pause', 'interrupt', 'resume'].map((action) => ({ path: `/v1/jobs/job-1/${action}`, query: '', body: {} })),
    { path: '/v1/slots/0', query: '?action=save', body: { filename: 'cache-1.bin' } },
    { path: '/v1/slots/1', query: '?action=restore', body: { filename: 'a'.repeat(120) } },
    { path: '/v1/slots/2', query: '?action=erase', body: undefined },
  ]);
  for (const action of ['delete', '../resume', 'pause?x=1', '', null]) {
    expect(() => adapter.controlJob('job-1', action as never)).toThrow(LemonadeStatusError);
    expect(() => adapter.controlSlot(0, action as never, { filename: 'safe.bin' })).toThrow(LemonadeStatusError);
  }
  for (const filename of ['', '.', '..', '../cache', '/cache', 'C:\\cache', 'a/b', 'a\\b', 'cache:stream', '%2e%2e', 'cache\0.bin', 'cache.', 'CON', 'nul.bin', 'a'.repeat(121)]) {
    for (const action of ['save', 'restore', 'erase'] as const) expect(() => adapter.controlSlot(0, action, { filename })).toThrow(LemonadeStatusError);
  }
  for (const input of [undefined, null, {}, { filename: 3 }]) expect(() => adapter.controlSlot(0, 'save', input as never)).toThrow(LemonadeStatusError);
  for (const id of [-1, 0.5, NaN, Infinity]) expect(() => adapter.controlSlot(id, 'erase')).toThrow(LemonadeStatusError);
  expect(sent).toHaveLength(6);
});

test('bootstrap status remains separate from model-list operations', async () => {
  const result = await runLemonadeOperation(new LemonadeManagementAdapter(descriptor, { request: async (input) => Response.json(new URL(String(input)).pathname.endsWith('health') ? { status: 'ready' } : { version: '2026.42.1' }) }), { operation: 'health' });
  expect(result).toEqual({ status: 'ready' });
});

test('accepts Lemonade health status ok as a ready runtime', async () => {
  const result = await (await import('../../../packages/providers/src/lemonade-status.adapter')).getLemonadeRuntimeStatus({
    ...descriptor,
    resolveSecret: () => 'private-key'
  }, {
    request: async (input) => Response.json(new URL(String(input)).pathname.endsWith('/health') ? { status: 'ok' } : { platform: 'fixture' })
  });
  expect(result.state).toBe('ready');
});


test('catalog browsing includes undownloaded models while installed listing stays separate', async () => {
  const urls: string[] = [];
  const adapter = new LemonadeManagementAdapter(descriptor, { request: async (input) => {
    urls.push(String(input)); return Response.json({ data: [] });
  } });
  await runLemonadeOperation(adapter, { operation: 'catalog-models' });
  await runLemonadeOperation(adapter, { operation: 'installed-models' });
  expect(urls.map((url) => new URL(url).searchParams.get('show_all'))).toEqual(['true', 'false']);
});
