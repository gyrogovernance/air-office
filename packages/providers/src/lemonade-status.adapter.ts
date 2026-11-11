export interface LemonadeRuntimeDescriptor {
  instanceId: string;
  generation: number;
  release: string;
  baseOrigin: string;
  resolveSecret: () => string | Promise<string>;
  inference?: { signal(model?: string): AbortSignal };
}

export type LemonadeHealthState = 'ready' | 'loading' | 'unavailable' | 'error';
export interface LemonadeRuntimeStatus {
  instanceId: string;
  generation: number;
  release: string;
  baseOrigin: string;
  state: LemonadeHealthState;
  health: unknown | null;
  systemInfo: unknown | null;
}
export type LemonadeFailureCode = 'timeout' | 'cancelled' | 'upstream' | 'protocol' | 'unavailable' | 'invalid-request';
export type LemonadeStatusFailureCode = LemonadeFailureCode;
export class LemonadeStatusError extends Error {
  constructor(readonly code: LemonadeFailureCode, readonly status: number | null = null, readonly detail: string | null = null) {
    super(code === 'upstream' ? 'The local model server rejected the request.' : 'The local model operation could not be completed.');
    this.name = 'LemonadeStatusError';
  }
}
export { LemonadeStatusError as LemonadeError };

type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface LemonadeRequestOptions { signal?: AbortSignal; timeoutMs?: number; maxResponseBytes?: number; request?: FetchTransport; }
export type LemonadeJson = Record<string, unknown> | unknown[];
export interface LemonadeModelInput { model_name: string; }
export interface LemonadePullInput extends LemonadeModelInput { recipe?: string; checkpoint?: string; variant?: string; stream?: boolean; subscribe?: boolean; [option: string]: unknown; }
export interface LemonadeInstallInput { recipe: string; backend: string; stream?: boolean; force?: boolean; }
export interface LemonadeInstallDryRunInput { recipe: string; backend: string; }
export interface LemonadeUninstallInput { recipe: string; backend: string; }
export interface LemonadeRegistrySearch { query: string; source?: 'huggingface' | 'modelscope'; limit?: number; format?: 'gguf'; }
export interface LemonadeDownloadControl { action: 'pause' | 'cancel' | 'remove'; id: string; }
export interface LemonadeModelOptions { [option: string]: string | number | boolean | null | undefined; dry_run?: boolean; }
export interface LemonadeModelRegistration { model_name: string; recipe: string; [field: string]: unknown; }
export interface LemonadeOwnedRegistration { model_name: string; recipe: string; checkpoint: string; }
/** Accept only a simple model directory name, never a browser-supplied filesystem path. */
export function validateOwnedModelRegistration(value: unknown): value is LemonadeOwnedRegistration {
  if (!record(value)) return false;
  const name = value.model_name;
  const recipe = value.recipe;
  const checkpoint = value.checkpoint;
  return validText(name, 120) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
    && validText(recipe, 80) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(recipe)
    && validText(checkpoint, 120) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(checkpoint) && checkpoint !== '.' && checkpoint !== '..';
}
export function ownedModelRegistrationPath(name: string, modelsDirectory: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name === '.' || name === '..') throw new Error('Invalid model directory name.');
  let end = modelsDirectory.length;
  while (end > 0 && (modelsDirectory[end - 1] === '/' || modelsDirectory[end - 1] === '\\')) end--;
  return `${modelsDirectory.slice(0, end)}/${name}`;
}
export interface LemonadeRoutingValidation { policy: Record<string, unknown>; prompt?: string; has_images?: boolean; has_tools?: boolean; metadata?: Record<string, string>; }
export interface LemonadeTokenizeInput { content: string; add_special?: boolean; parse_special?: boolean; with_pieces?: boolean; }
export interface LemonadeClassifyInput { input: string; model?: string; top_k?: number; }
export interface LemonadeJobRequest { type?: string; name?: string; definition?: Record<string, unknown> | unknown[]; steps?: unknown[]; inputs?: Record<string, unknown>; [field: string]: unknown; }
export interface LemonadeSlotCacheInput { filename: string; }
export interface LemonadeConfigChange { key: string; value: unknown; }
export interface LemonadePinInput { model_name: string; pinned: boolean; }
export interface LemonadeAliasInput { alias: string; model_name: string; }

function configInteger(value: unknown, minimum: number, maximum = 2_147_483_647): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum; }

/**
 * Engine binaries the runtime can be pointed at. The runtime resolves a
 * `<section>_<variant>_bin` key to a backend binary and prefers it over a
 * managed installation, which lets a user run an engine they already have.
 */
const engineBinVariants: Record<string, string[]> = {
  llamacpp: ['rocm', 'vulkan', 'cuda', 'cpu'], hrx: ['hrx'], sdcpp: ['cpu', 'rocm', 'vulkan', 'cuda'], ryzenai: ['server'], thenoise: ['rocm'],
  whispercpp: ['cpu', 'npu'], kokoro: ['cpu'], onnxruntime: ['cpu'], moonshine: ['cpu'], acestep: ['vulkan', 'rocm', 'cuda'],
  openmoss: ['vulkan', 'cuda'], trellis: ['vulkan', 'rocm', 'cuda'], thinksound: ['vulkan', 'rocm', 'cuda'],
};
/** An engine binary is either the managed engine or an absolute path that exists. */
function validEngineBinary(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f]/.test(value)) return false;
  if (value === 'builtin') return true;
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
}
/** Ordinary settings from the pinned RuntimeConfig::validate; privileged sections stay host-owned. */
function validSafeConfig(input: unknown): input is LemonadeConfigChange {
  if (!record(input) || typeof input.key !== 'string') return false;
  const value = input.value;
  switch (input.key) {
    case 'log_level': return typeof value === 'string' && ['trace', 'debug', 'info', 'warning', 'error', 'fatal', 'none'].includes(value);
    case 'log_max_file_size_mb': return configInteger(value, 1, 2048);
    case 'log_max_files': return configInteger(value, 0, 100);
    case 'global_timeout': return configInteger(value, 1);
    case 'max_loaded_models': return value === -1 || configInteger(value, 1);
    // The pinned validator accepts both -1 and 0 as well as positive context sizes.
    case 'ctx_size': return configInteger(value, -1);
    case 'auto_evict': case 'inhibit_suspend': case 'disable_model_filtering': case 'enable_dgpu_gtt': return typeof value === 'boolean';
    case 'auto_evict_threshold_pct': return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
    default: return validEngineConfig(input.key, value);
  }
}

/** Backends a user can pin for the chat engine. */
const llamacppBackends = ['cpu', 'vulkan', 'cuda', 'rocm', 'system'];
/**
 * Engine settings the runtime accepts in its flat `<section>_<field>` form. A
 * binary path lets a user run an engine they already installed; the runtime
 * prefers such a binary over a managed installation.
 */
function validEngineConfig(key: string, value: unknown): boolean {
  const separator = key.indexOf('_');
  if (separator < 1) return false;
  const section = key.slice(0, separator);
  const field = key.slice(separator + 1);
  const variants = engineBinVariants[section];
  if (variants && field.endsWith('_bin') && variants.includes(field.slice(0, -'_bin'.length))) return validEngineBinary(value);
  if (section === 'llamacpp' && field === 'backend') return typeof value === 'string' && llamacppBackends.includes(value);
  return false;
}
function validSlotFilename(value: unknown): value is string {
  return validText(value, 120) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.endsWith('.')
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);
}

function validAlias(value: unknown): value is string { return validText(value, 120) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value); }
function validOptionValue(value: unknown): value is string | number | boolean | null { return value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value); }
function validOptions(value: unknown): value is LemonadeModelOptions {
  return record(value) && Object.entries(value).every(([key, item]) => validText(key, 120) && validOptionValue(item));
}

const DEFAULT_LIMIT = 512_000;
const DEFAULT_TIMEOUT = 15_000;
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function validText(value: unknown, max = 200): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function boundedId(value: string): string { if (!validText(value, 300) || value.includes('\\0')) throw new LemonadeStatusError('invalid-request'); return encodeURIComponent(value); }
function validateDescriptor(d: LemonadeRuntimeDescriptor): URL {
  if (!validText(d.instanceId) || !Number.isSafeInteger(d.generation) || d.generation < 0 || !validText(d.release)) throw new LemonadeStatusError('invalid-request');
  try { const u = new URL(d.baseOrigin); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(); return u; }
  catch { throw new LemonadeStatusError('invalid-request'); }
}
async function parseBody(response: Response, limit: number): Promise<LemonadeJson> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > limit) throw new LemonadeStatusError('protocol', response.status);
  if (!response.body) throw new LemonadeStatusError('protocol', response.status);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new LemonadeStatusError('protocol', response.status); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!record(parsed) && !Array.isArray(parsed)) throw new Error(); return parsed as LemonadeJson; }
  catch { throw new LemonadeStatusError('protocol', response.status); }
}

export class LemonadeManagementAdapter {
  private readonly origin: URL;
  constructor(private readonly descriptor: LemonadeRuntimeDescriptor, private readonly defaults: LemonadeRequestOptions = {}) { this.origin = validateDescriptor(descriptor); }
  get baseOrigin(): string { return this.origin.origin; }
  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object, query?: Record<string, string | number | boolean | undefined>, options: LemonadeRequestOptions = {}): Promise<LemonadeJson> {
    const opts = { ...this.defaults, ...options };
    const startsInference = ['/v1/load', '/v1/tokenize', '/v1/classify', '/v1/jobs', '/v1/routing/validate'].includes(path) || path.startsWith('/v1/jobs/') && path.endsWith('/resume');
    if (method === 'POST' && startsInference && this.descriptor.inference) {
      const model = record(body) && typeof body.model_name === 'string' ? body.model_name : record(body) && typeof body.model === 'string' ? body.model : undefined;
      const gate = this.descriptor.inference.signal(model);
      opts.signal = opts.signal ? AbortSignal.any([opts.signal, gate]) : gate;
    }
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT; const limit = opts.maxResponseBytes ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(limit) || limit < 1 || (body && (!record(body) || new TextEncoder().encode(JSON.stringify(body)).byteLength > limit))) throw new LemonadeStatusError('invalid-request');
    const url = new URL(path, this.origin); for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
    const controller = new AbortController(); const abort = () => controller.abort(opts.signal?.reason); opts.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
    try {
      if (opts.signal?.aborted) throw new LemonadeStatusError('cancelled');
      const secret = await this.descriptor.resolveSecret(); if (!secret) throw new LemonadeStatusError('unavailable');
      let response: Response;
      try {
        const pending = (opts.request ?? fetch)(url, { method, headers: { authorization: `Bearer ${secret}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
        const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new LemonadeStatusError(opts.signal?.aborted ? 'cancelled' : 'timeout')), { once: true }));
        response = await Promise.race([pending, aborted]);
      }
      catch (error) { if (error instanceof LemonadeStatusError) throw error; throw new LemonadeStatusError(opts.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'unavailable'); }
      if (!response.ok && !(response.status === 503 && path === '/v1/health')) { await response.body?.cancel(); throw new LemonadeStatusError('upstream', response.status); }
      if (response.status === 503 && path === '/v1/health') { try { return await parseBody(response, limit); } catch { return {}; } }
      return await parseBody(response, limit);
    } catch (error) { if (error instanceof LemonadeStatusError) throw error; throw new LemonadeStatusError(opts.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'unavailable'); }
    finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', abort); }
  }
  getSystemInfo(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/system-info', undefined, undefined, options); }
  getHealth(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/health', undefined, undefined, options); }
  getStats(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/stats', undefined, undefined, options); }
  getSystemStats(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/system-stats', undefined, undefined, options); }
  install(input: LemonadeInstallInput, options?: LemonadeRequestOptions) { if (!validText(input.recipe) || !validText(input.backend)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/install', input, undefined, options); }
  dryRunInstall(input: LemonadeInstallDryRunInput, options?: LemonadeRequestOptions) { if (!validText(input.recipe) || !validText(input.backend)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/install/dry-run', input, undefined, options); }
  uninstall(input: LemonadeUninstallInput, options?: LemonadeRequestOptions) { if (!validText(input.recipe) || !validText(input.backend)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/uninstall', input, undefined, options); }
  searchRegistry(input: LemonadeRegistrySearch, options?: LemonadeRequestOptions) { if (!validText(input.query, 500) || input.query.trim().length < 3 || input.source !== undefined && !['huggingface', 'modelscope'].includes(input.source) || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) || input.format !== undefined && input.format !== 'gguf') throw new LemonadeStatusError('invalid-request'); return this.call('GET', '/v1/registry/search', undefined, { query: input.query, source: input.source, limit: input.limit, format: input.format }, options); }
  getVariants(checkpoint: string, options?: LemonadeRequestOptions) { if (!validText(checkpoint, 500)) throw new LemonadeStatusError('invalid-request'); return this.call('GET', '/v1/pull/variants', undefined, { checkpoint }, options); }
  listCatalogModels(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/models', undefined, { show_all: true }, options); }
  listUnfilteredCatalogModels(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/models', undefined, { show_all: true }, options); }
  listInstalledModels(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/models', undefined, { show_all: false }, options); }
  getModelFiles(model: string, includePaths = false, options?: LemonadeRequestOptions) { return this.call('GET', `/v1/models/${boundedId(model)}/files`, undefined, { include_paths: includePaths }, options); }
  pull(input: LemonadePullInput, options?: LemonadeRequestOptions) { if (!validText(input.model_name)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/pull', input, undefined, options); }
  listDownloads(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/downloads', undefined, undefined, options); }
  controlDownload(input: LemonadeDownloadControl, options?: LemonadeRequestOptions) { if (!validText(input.id) || !['pause', 'cancel', 'remove'].includes(input.action)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/downloads/control', input, undefined, options); }
  loadModel(input: LemonadePullInput | LemonadeModelInput, options?: LemonadeRequestOptions) { if (!validText(input.model_name)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/load', input, undefined, options); }
  unloadModel(input: LemonadeModelInput, options?: LemonadeRequestOptions) { return this.call('POST', '/v1/unload', input, undefined, options); }
  unloadAllModels(options?: LemonadeRequestOptions) { return this.call('POST', '/v1/unload', undefined, undefined, options); }
  deleteModel(input: LemonadeModelInput, options?: LemonadeRequestOptions) { return this.call('POST', '/v1/delete', input, undefined, options); }
  getModelOptions(model: string, options?: LemonadeRequestOptions) { return this.call('GET', `/v1/models/${boundedId(model)}/options`, undefined, undefined, options); }
  saveModelOptions(model: string, optionsValue: LemonadeModelOptions, options?: LemonadeRequestOptions) { if (!validOptions(optionsValue)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', `/v1/models/${boundedId(model)}/options`, optionsValue as Record<string, unknown>, undefined, options); }
  resetModelOptions(model: string, options?: LemonadeRequestOptions) { return this.call('DELETE', `/v1/models/${boundedId(model)}/options`, undefined, undefined, options); }
  registerModel(input: LemonadeModelRegistration, options?: LemonadeRequestOptions) { if (!validText(input.model_name) || !validText(input.recipe) || !validText(input.checkpoint, 500)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/models/register', input, undefined, options); }
  checkUpdates(options?: LemonadeRequestOptions) { return this.call('POST', '/v1/models/check-updates', {}, undefined, options); }
  validateRouting(input: LemonadeRoutingValidation, options?: LemonadeRequestOptions) { if (!record(input) || !record(input.policy) || input.prompt !== undefined && typeof input.prompt !== 'string' || input.has_images !== undefined && typeof input.has_images !== 'boolean' || input.has_tools !== undefined && typeof input.has_tools !== 'boolean' || input.metadata !== undefined && (!record(input.metadata) || !Object.values(input.metadata).every((value) => typeof value === 'string'))) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/routing/validate', input, undefined, options); }
  createJob(input: LemonadeJobRequest, options?: LemonadeRequestOptions) { if ((!validText(input.name) && !validText(input.type)) || input.definition !== undefined && !record(input.definition) && !Array.isArray(input.definition) || input.steps !== undefined && !Array.isArray(input.steps) || input.inputs !== undefined && !record(input.inputs)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/jobs', input, undefined, options); }
  listJobs(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/jobs', undefined, undefined, options); }
  getJob(id: string, options?: LemonadeRequestOptions) { return this.call('GET', `/v1/jobs/${boundedId(id)}`, undefined, undefined, options); }
  controlJob(id: string, action: 'pause' | 'interrupt' | 'resume', options?: LemonadeRequestOptions) { if (!['pause', 'interrupt', 'resume'].includes(action)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', `/v1/jobs/${boundedId(id)}/${action}`, {}, undefined, options); }
  deleteJob(id: string, options?: LemonadeRequestOptions) { return this.call('DELETE', `/v1/jobs/${boundedId(id)}`, undefined, undefined, options); }
  listSlots(options?: LemonadeRequestOptions) { return this.call('GET', '/v1/slots', undefined, undefined, options); }
  controlSlot(id: number, action: 'save' | 'restore' | 'erase', input?: LemonadeSlotCacheInput, options?: LemonadeRequestOptions) {
    if (!Number.isSafeInteger(id) || id < 0 || !['save', 'restore', 'erase'].includes(action)
      || (action !== 'erase' && (!record(input) || !validSlotFilename(input.filename)))
      || (input !== undefined && (!record(input) || !validSlotFilename(input.filename)))) throw new LemonadeStatusError('invalid-request');
    return this.call('POST', `/v1/slots/${id}`, action === 'erase' ? undefined : { filename: input!.filename }, { action }, options);
  }
  tokenize(input: LemonadeTokenizeInput, options?: LemonadeRequestOptions) { if (!validText(input.content, 100_000)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/tokenize', input, undefined, options); }
  classify(input: LemonadeClassifyInput, options?: LemonadeRequestOptions) { if (!validText(input.input, 100_000) || input.model !== undefined && !validText(input.model) || input.top_k !== undefined && (!Number.isSafeInteger(input.top_k) || input.top_k < 1)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/v1/classify', input, undefined, options); }
  getConfig(options?: LemonadeRequestOptions) { return this.call('GET', '/internal/config', undefined, undefined, options); }
  getConfigDefaults(options?: LemonadeRequestOptions) { return this.call('GET', '/internal/config/defaults', undefined, undefined, options); }
  /** extra_models_dir is reserved for a direct call after native folder authorization. */
  setConfig(input: LemonadeConfigChange, options?: LemonadeRequestOptions) {
    const trustedStorage = record(input) && input.key === 'extra_models_dir' && typeof input.value === 'string' && input.value.length <= 4096 && !/[\u0000-\u001f]/.test(input.value);
    if (!validSafeConfig(input) && !trustedStorage) throw new LemonadeStatusError('invalid-request');
    return this.call('POST', '/internal/set', { [input.key]: input.value }, undefined, options);
  }
  pinModel(input: LemonadePinInput, options?: LemonadeRequestOptions) { if (!validText(input.model_name) || typeof input.pinned !== 'boolean') throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/internal/pin', input, undefined, options); }
  listAliases(options?: LemonadeRequestOptions) { return this.call('GET', '/internal/aliases', undefined, undefined, options); }
  addAlias(input: LemonadeAliasInput, options?: LemonadeRequestOptions) { if (!validAlias(input.alias) || !validText(input.model_name)) throw new LemonadeStatusError('invalid-request'); return this.call('POST', '/internal/aliases', input, undefined, options); }
  removeAlias(alias: string, options?: LemonadeRequestOptions) { if (!validAlias(alias)) throw new LemonadeStatusError('invalid-request'); return this.call('DELETE', `/internal/aliases/${boundedId(alias)}`, undefined, undefined, options); }
  syncModels(options?: LemonadeRequestOptions) { return this.call('POST', '/internal/models/sync', {}, undefined, options); }
  getModelSyncStatus(options?: LemonadeRequestOptions) { return this.call('GET', '/internal/models/sync/status', undefined, undefined, options); }
  cleanupCache(options?: LemonadeRequestOptions) { return this.call('POST', '/internal/cleanup-cache', {}, undefined, options); }
}

export type LemonadeOperation =
  | { operation: 'system-info' | 'health' | 'stats' | 'system-stats' | 'catalog-models' | 'installed-models' | 'downloads' | 'check-updates' | 'jobs' | 'slots' | 'config' | 'config-defaults' | 'aliases' | 'sync-models' | 'sync-status' | 'cleanup-cache' }
  | { operation: 'registry-search'; input: LemonadeRegistrySearch }
  | { operation: 'variants'; checkpoint: string }
  | { operation: 'model-files'; model: string; includePaths?: boolean }
  | { operation: 'pull'; input: LemonadePullInput }
  | { operation: 'install' | 'install-dry-run' | 'uninstall'; input: LemonadeInstallInput | LemonadeInstallDryRunInput | LemonadeUninstallInput }
  | { operation: 'download-control'; input: LemonadeDownloadControl }
  | { operation: 'load'; input: LemonadePullInput | LemonadeModelInput }
  | { operation: 'unload' | 'delete'; input: LemonadeModelInput }
  | { operation: 'model-options'; model: string }
  | { operation: 'save-model-options'; model: string; options: LemonadeModelOptions }
  | { operation: 'reset-model-options'; model: string }
  | { operation: 'register-model'; input: LemonadeModelRegistration }
  | { operation: 'validate-routing'; input: LemonadeRoutingValidation }
  | { operation: 'job'; id: string }
  | { operation: 'create-job'; input: LemonadeJobRequest }
  | { operation: 'job-control'; id: string; action: 'pause' | 'interrupt' | 'resume' }
  | { operation: 'delete-job'; id: string }
  | { operation: 'slot-control'; id: number; action: 'save' | 'restore' | 'erase'; input?: LemonadeSlotCacheInput }
  | { operation: 'tokenize'; input: LemonadeTokenizeInput }
  | { operation: 'classify'; input: LemonadeClassifyInput }
  | { operation: 'set-config'; input: LemonadeConfigChange }
  | { operation: 'pin'; input: LemonadePinInput }
  | { operation: 'add-alias'; input: LemonadeAliasInput }
  | { operation: 'remove-alias'; alias: string };

export async function runLemonadeOperation(adapter: LemonadeManagementAdapter, operation: LemonadeOperation, options?: LemonadeRequestOptions): Promise<LemonadeJson | LemonadeRuntimeStatus> {
  switch (operation.operation) {
    case 'system-info': return adapter.getSystemInfo(options); case 'health': return adapter.getHealth(options); case 'stats': return adapter.getStats(options); case 'system-stats': return adapter.getSystemStats(options);
    case 'catalog-models': return adapter.listCatalogModels(options);
    case 'installed-models': return adapter.listInstalledModels(options); case 'downloads': return adapter.listDownloads(options); case 'check-updates': return adapter.checkUpdates(options); case 'jobs': return adapter.listJobs(options); case 'slots': return adapter.listSlots(options);
    case 'config': return adapter.getConfig(options); case 'config-defaults': return adapter.getConfigDefaults(options); case 'aliases': return adapter.listAliases(options); case 'sync-models': return adapter.syncModels(options); case 'sync-status': return adapter.getModelSyncStatus(options); case 'cleanup-cache': return adapter.cleanupCache(options);
    case 'registry-search': return adapter.searchRegistry(operation.input, options); case 'variants': return adapter.getVariants(operation.checkpoint, options); case 'model-files': return adapter.getModelFiles(operation.model, operation.includePaths, options);
    case 'pull': return adapter.pull(operation.input, options); case 'install': return adapter.install(operation.input as LemonadeInstallInput, options); case 'install-dry-run': return adapter.dryRunInstall(operation.input as LemonadeInstallDryRunInput, options); case 'uninstall': return adapter.uninstall(operation.input as LemonadeUninstallInput, options); case 'download-control': return adapter.controlDownload(operation.input, options);
    case 'load': return adapter.loadModel(operation.input, options); case 'unload': return adapter.unloadModel(operation.input, options); case 'delete': return adapter.deleteModel(operation.input, options);
    case 'model-options': return adapter.getModelOptions(operation.model, options); case 'save-model-options': return adapter.saveModelOptions(operation.model, operation.options, options); case 'reset-model-options': return adapter.resetModelOptions(operation.model, options); case 'register-model': return adapter.registerModel(operation.input, options); case 'validate-routing': return adapter.validateRouting(operation.input, options);
    case 'job': return adapter.getJob(operation.id, options); case 'create-job': return adapter.createJob(operation.input, options); case 'job-control': return adapter.controlJob(operation.id, operation.action, options); case 'delete-job': return adapter.deleteJob(operation.id, options);
    case 'slot-control': return adapter.controlSlot(operation.id, operation.action, operation.input, options); case 'tokenize': return adapter.tokenize(operation.input, options); case 'classify': return adapter.classify(operation.input, options); case 'set-config': if (!validSafeConfig(operation.input)) throw new LemonadeStatusError('invalid-request'); return adapter.setConfig(operation.input, options); case 'pin': return adapter.pinModel(operation.input, options); case 'add-alias': return adapter.addAlias(operation.input, options); case 'remove-alias': return adapter.removeAlias(operation.alias, options);
  }
}

export async function getLemonadeRuntimeStatus(descriptor: LemonadeRuntimeDescriptor, options: LemonadeRequestOptions = {}): Promise<LemonadeRuntimeStatus> {
  const adapter = new LemonadeManagementAdapter(descriptor, options);
  const [health, systemInfo] = await Promise.all([adapter.getHealth(options), adapter.getSystemInfo(options)]);
  const h = (health ?? {}) as Record<string, unknown>;
  // Lemonade's current health endpoint reports `status: "ok"`; retain
  // compatibility with the documented `ready` spelling and explicit flag.
  const status = h.status === 'ok' || h.status === 'ready' || h.ready === true ? 'ready' : h.status === 'loading' || h.status === 'starting' || Object.keys(h).length === 0 ? 'loading' : 'error';
  return { instanceId: descriptor.instanceId, generation: descriptor.generation, release: descriptor.release, baseOrigin: adapter.baseOrigin, state: status, health, systemInfo };
}
