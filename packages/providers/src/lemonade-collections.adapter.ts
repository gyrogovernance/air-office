import { LemonadeManagementAdapter, LemonadeStatusError, type LemonadeRequestOptions, type LemonadeRuntimeDescriptor } from './lemonade-status.adapter';

export interface CollectionDefinition {
  model_name: string;
  recipe: 'collection.omni' | 'collection.router';
  version?: '1';
  components: string[];
  system_prompt?: string;
  routing?: Record<string, unknown>;
  models?: Record<string, unknown>[];
  labels?: string[];
  recipe_options?: Record<string, unknown>;
}
export type CollectionOperation =
  | { operation: 'import-collection'; definition: unknown }
  | { operation: 'save-collection'; definition: unknown }
  | { operation: 'export-collection'; model: string }
  | { operation: 'routing-defaults' }
  | { operation: 'test-collection-routing'; definition: unknown; prompt: string; has_images?: boolean; has_tools?: boolean; metadata?: Record<string, string> };
export const COLLECTION_ROUTER_PROMPT = 'You route user requests to the best model. Reply with ONLY the exact model name, nothing else.';
export const COLLECTION_MAX_BYTES = 512 * 1024;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100_000;
const id = (value: unknown): value is string => text(value) && value.length <= 500 && !/[\u0000-\u001f]/.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 128 && value.every(id) && new Set(value).size === value.length;
function invalid(): never { throw new LemonadeStatusError('invalid-request'); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(); }
function bounded(value: unknown) { try { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > COLLECTION_MAX_BYTES) invalid(); } catch { invalid(); } }

function condition(value: unknown, classifiers: Set<string>, depth = 0): void {
  if (!object(value) || !Object.keys(value).length || depth > 12) invalid();
  keys(value, ['any', 'all', 'not', 'keywords_any', 'keywords_all', 'regex', 'min_chars', 'max_chars', 'min_total_chars', 'max_total_chars', 'has_tools', 'has_images', 'metadata', 'classifier', 'label', 'min_score', 'max_score']);
  for (const [key, field] of Object.entries(value)) {
    if (key === 'any' || key === 'all') { if (!Array.isArray(field) || !field.length || field.length > 64) invalid(); field.forEach((child) => condition(child, classifiers, depth + 1)); }
    else if (key === 'not') condition(field, classifiers, depth + 1);
    else if (key.startsWith('keywords_')) { if (!strings(field)) invalid(); }
    else if (key === 'regex') { if (!text(field)) invalid(); }
    else if (['min_chars', 'max_chars', 'min_total_chars', 'max_total_chars'].includes(key)) { if (!Number.isSafeInteger(field) || Number(field) < 0) invalid(); }
    else if (key === 'has_tools' || key === 'has_images') { if (typeof field !== 'boolean') invalid(); }
    else if (key === 'metadata') {
      if (!object(field) || !id(field.key)) invalid(); keys(field, ['key', 'equals', 'any', 'exists']);
      if (['equals', 'any', 'exists'].filter((name) => Object.hasOwn(field, name)).length !== 1 || field.equals !== undefined && typeof field.equals !== 'string' || field.any !== undefined && !strings(field.any) || field.exists !== undefined && typeof field.exists !== 'boolean') invalid();
    } else if (key === 'classifier') { if (!id(field) || !classifiers.has(field) || !id(value.label)) invalid(); }
    else if (key === 'label') { if (!id(field) || !id(value.classifier)) invalid(); }
    else if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 1 || !id(value.classifier)) invalid();
  }
  if (typeof value.min_score === 'number' && typeof value.max_score === 'number' && value.min_score > value.max_score) invalid();
}
function routing(value: unknown, components: string[]): void {
  if (!object(value)) invalid(); keys(value, ['candidates', 'default_model', 'rules', 'router', 'classifiers']);
  if (!strings(value.candidates) || value.candidates.some((name) => !components.includes(name)) || !id(value.default_model) || !value.candidates.includes(value.default_model)) invalid();
  const classifiers = new Set<string>();
  if (value.classifiers !== undefined) {
    if (!Array.isArray(value.classifiers) || value.classifiers.length > 64) invalid();
    for (const entry of value.classifiers) {
      if (!object(entry) || !id(entry.id) || classifiers.has(entry.id) || !id(entry.model) || !components.includes(entry.model)) invalid();
      keys(entry, ['id', 'type', 'model', 'labels', 'prompt', 'reference_phrases', 'default_label', 'on_error']);
      if (!['llm', 'classifier', 'semantic_similarity'].includes(String(entry.type))) invalid();
      if (entry.type === 'semantic_similarity') { if (!object(entry.reference_phrases) || !Object.keys(entry.reference_phrases).length || !Object.values(entry.reference_phrases).every(strings)) invalid(); }
      else if (!strings(entry.labels) || entry.type === 'llm' && !text(entry.prompt)) invalid();
      if (entry.default_label !== undefined && (!Array.isArray(entry.labels) || !entry.labels.includes(entry.default_label))) invalid();
      if (entry.on_error !== undefined && !['match_false', 'match_true'].includes(String(entry.on_error))) invalid();
      classifiers.add(entry.id);
    }
  }
  if (Object.hasOwn(value, 'rules') === Object.hasOwn(value, 'router')) invalid();
  if (value.router !== undefined) {
    if (!object(value.router)) invalid(); keys(value.router, ['type', 'model', 'prompt', 'on_error']);
    if (value.router.type !== 'llm' || !id(value.router.model) || !components.includes(value.router.model) || !text(value.router.prompt)) invalid();
  } else {
    if (!Array.isArray(value.rules) || value.rules.length > 128) invalid();
    const ids = new Set<string>();
    for (const rule of value.rules) {
      if (!object(rule) || !id(rule.id) || ids.has(rule.id) || !id(rule.route_to) || !value.candidates.includes(rule.route_to)) invalid();
      keys(rule, ['id', 'match', 'route_to', 'outputs']); if (rule.outputs !== undefined && !object(rule.outputs)) invalid();
      condition(rule.match, classifiers); ids.add(rule.id);
    }
  }
}

/** Validates import-ready upstream definitions without rewriting any model reference. */
export function parseCollectionDefinition(input: unknown): CollectionDefinition {
  bounded(input); if (!object(input)) invalid();
  keys(input, ['version', 'model_name', 'recipe', 'components', 'models', 'routing', 'system_prompt', 'labels', 'recipe_options', 'checkpoints', 'source']);
  if (!id(input.model_name) || !/^user\.(?!builtin\.|extra\.)[^\s/\\]+$/.test(input.model_name) || !['collection.omni', 'collection.router'].includes(String(input.recipe)) || !strings(input.components) || input.components.includes(input.model_name)) invalid();
  if (input.version !== undefined && input.version !== '1') invalid();
  if (input.recipe === 'collection.router') { if (input.version !== '1') invalid(); routing(input.routing, input.components); }
  else if (input.routing !== undefined) invalid();
  if (input.system_prompt !== undefined && (input.recipe !== 'collection.omni' || !text(input.system_prompt) || !input.system_prompt.includes('{tool_list}') || !input.system_prompt.includes('{tool_guidance}'))) invalid();
  if (input.labels !== undefined && (!Array.isArray(input.labels) || !input.labels.every(id))) invalid();
  if (input.recipe_options !== undefined && !object(input.recipe_options)) invalid();
  if (input.source !== undefined && !['huggingface', 'modelscope'].includes(String(input.source))) invalid();
  if (input.checkpoints !== undefined && (!object(input.checkpoints) || Object.values(input.checkpoints).some((value) => value !== ''))) invalid();
  if (input.models !== undefined) {
    if (!Array.isArray(input.models) || input.models.length > input.components.length) invalid();
    const names = new Set<string>();
    for (const entry of input.models) {
      if (!object(entry)) invalid(); keys(entry, ['model_name', 'recipe', 'checkpoint', 'checkpoints', 'source', 'labels', 'recipe_options', 'size']);
      if (!id(entry.model_name) || !input.components.includes(entry.model_name) || names.has(entry.model_name) || !id(entry.recipe) || entry.recipe.startsWith('collection.')) invalid();
      if (entry.source !== undefined && !['huggingface', 'modelscope'].includes(String(entry.source))) invalid();
      const checkpoints = entry.checkpoints ?? (typeof entry.checkpoint === 'string' ? { main: entry.checkpoint } : null);
      // Browser-supplied definitions may reference registry checkpoints, never local files or arbitrary URLs.
      if (!object(checkpoints) || !Object.keys(checkpoints).length || !Object.values(checkpoints).every((checkpoint) => typeof checkpoint === 'string' && /^[\w.-]+\/[\w.-]+(?::[\w.\/-]+)?$/.test(checkpoint) && !checkpoint.split(/[/:]/).includes('..'))) invalid();
      if (entry.labels !== undefined && (!Array.isArray(entry.labels) || !entry.labels.every(id)) || entry.recipe_options !== undefined && !object(entry.recipe_options) || entry.size !== undefined && (typeof entry.size !== 'number' || !Number.isFinite(entry.size) || entry.size < 0)) invalid();
      names.add(entry.model_name);
    }
  }
  return structuredClone(input) as unknown as CollectionDefinition;
}

function portableModel(value: unknown, fallback?: string): Record<string, unknown> {
  if (!object(value)) throw new LemonadeStatusError('protocol');
  const result: Record<string, unknown> = {};
  for (const field of ['recipe', 'checkpoints', 'checkpoint', 'source', 'labels', 'recipe_options', 'size', 'components', 'routing', 'system_prompt', 'version']) if (value[field] !== undefined) result[field] = value[field];
  result.model_name = fallback ?? value.id ?? value.model_name;
  if (result.checkpoints !== undefined) delete result.checkpoint;
  const source = value.source ?? value.registry_source;
  if (source === 'huggingface' || source === 'modelscope') result.source = source;
  else delete result.source;
  if (Array.isArray(result.components) && result.components.length === 0) delete result.components;
  return result;
}

export class LemonadeCollectionsAdapter {
  private readonly management: LemonadeManagementAdapter;
  private readonly origin: URL;
  constructor(private readonly descriptor: LemonadeRuntimeDescriptor, private readonly defaults: LemonadeRequestOptions = {}) {
    this.management = new LemonadeManagementAdapter(descriptor, defaults);
    this.origin = new URL(descriptor.baseOrigin);
  }
  private async call(method: 'GET' | 'POST', path: string, body: unknown, options: LemonadeRequestOptions = {}): Promise<unknown> {
    const config = { ...this.defaults, ...options }; const timeout = config.timeoutMs ?? 30_000; const limit = config.maxResponseBytes ?? COLLECTION_MAX_BYTES;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(limit) || limit < 1) invalid();
    const controller = new AbortController(); const abort = () => controller.abort();
    config.signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, timeout);
    try {
      if (config.signal?.aborted) throw new LemonadeStatusError('cancelled');
      const secret = await this.descriptor.resolveSecret(); if (!secret) throw new LemonadeStatusError('unavailable');
      const response = await (config.request ?? fetch)(new URL(path, this.origin), { method, redirect: 'error', headers: { authorization: `Bearer ${secret}`, accept: 'application/json', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); throw new LemonadeStatusError('upstream', response.status); }
      const reader = response.body?.getReader(); if (!reader) throw new LemonadeStatusError('protocol');
      const chunks: Uint8Array[] = []; let length = 0;
      try { for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > limit) { await reader.cancel(); throw new LemonadeStatusError('protocol'); } chunks.push(item.value); } } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw new LemonadeStatusError('protocol'); }
    } catch (error) {
      if (error instanceof LemonadeStatusError) throw error;
      throw new LemonadeStatusError(config.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally { clearTimeout(timer); config.signal?.removeEventListener('abort', abort); }
  }
  async importCollection(input: unknown, options?: LemonadeRequestOptions) {
    const definition = parseCollectionDefinition(input);
    // Pull preserves existing component registrations and imports unknown embedded definitions upstream.
    return this.call('POST', '/v1/pull', { ...definition, stream: false, subscribe: false }, options);
  }
  async saveCollection(input: unknown, options?: LemonadeRequestOptions) {
    const definition = parseCollectionDefinition(input);
    if (definition.models?.length) invalid();
    return this.call('POST', '/v1/models/register', definition, options);
  }
  async exportCollection(model: string, options?: LemonadeRequestOptions): Promise<CollectionDefinition> {
    if (!id(model)) invalid();
    const raw = await this.call('GET', `/v1/models/${encodeURIComponent(model)}`, undefined, options);
    const definition = portableModel(raw, model);
    if (!Array.isArray(definition.components) || !definition.components.every(id)) throw new LemonadeStatusError('protocol');
    // Built-in collection exports become a new user entry; existing user IDs stay byte-for-byte stable.
    definition.model_name = model.startsWith('user.') ? model : `user.${model.replace(/^builtin\./, '')}`;
    if (definition.recipe === 'collection.router') definition.version = '1';
    const models: Record<string, unknown>[] = [];
    for (const component of definition.components) models.push(portableModel(await this.call('GET', `/v1/models/${encodeURIComponent(component)}`, undefined, options), component));
    definition.models = models;
    try { return parseCollectionDefinition(definition); } catch { throw new LemonadeStatusError('protocol'); }
  }
  async testRouting(input: Extract<CollectionOperation, { operation: 'test-collection-routing' }>, options?: LemonadeRequestOptions) {
    const policy = parseCollectionDefinition(input.definition);
    if (policy.recipe !== 'collection.router' || typeof input.prompt !== 'string' || input.prompt.length > 100_000) invalid();
    return this.management.validateRouting({ policy: policy as unknown as Record<string, unknown>, prompt: input.prompt, has_images: input.has_images, has_tools: input.has_tools, metadata: input.metadata }, options);
  }
}
export async function runCollectionOperation(adapter: LemonadeCollectionsAdapter, value: unknown, options?: LemonadeRequestOptions): Promise<unknown> {
  if (!object(value)) invalid();
  switch (value.operation) {
    case 'routing-defaults': keys(value, ['operation']); return { mode: 'llm', routerPrompt: COLLECTION_ROUTER_PROMPT, systemPrompt: null, rules: [], note: 'An omitted omni prompt inherits the runtime template.' };
    case 'import-collection': keys(value, ['operation', 'definition']); return adapter.importCollection(value.definition, options);
    case 'save-collection': keys(value, ['operation', 'definition']); return adapter.saveCollection(value.definition, options);
    case 'export-collection': keys(value, ['operation', 'model']); if (!id(value.model)) invalid(); return adapter.exportCollection(value.model, options);
    case 'test-collection-routing': keys(value, ['operation', 'definition', 'prompt', 'has_images', 'has_tools', 'metadata']); return adapter.testRouting(value as unknown as Extract<CollectionOperation, { operation: 'test-collection-routing' }>, options);
    default: return invalid();
  }
}
