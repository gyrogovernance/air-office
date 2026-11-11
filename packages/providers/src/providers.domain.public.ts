export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export type ProviderProtocol = 'ollama' | 'openai-compatible' | 'openai-responses' | 'azure-openai' | 'anthropic' | 'gemini';
export function isLoopbackProvider(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(baseUrl).hostname.toLowerCase()); }
  catch { return false; }
}
export interface ModelCapabilityDescriptor {
  model: string;
  tools: CapabilitySupport;
  vision: CapabilitySupport;
  streaming: CapabilitySupport;
  reasoning: CapabilitySupport;
  structuredOutput: CapabilitySupport;
  contextWindow: number | null;
  source: 'provider-metadata' | 'operator' | 'unknown';
}
export interface ProviderFailure {
  code: 'auth' | 'quota' | 'rate-limit' | 'tls' | 'network' | 'timeout' | 'context-limit' | 'capacity' | 'protocol' | 'cancelled' | 'unknown';
  message: string;
  retryable: boolean;
  status?: number;
}

/** How the most recent model listing for a connection turned out. `unknown` means no listing has been attempted since the connection was saved. */
export type ModelDiscoveryOutcome = 'unknown' | 'success' | 'empty' | 'failed';

export interface ModelConnection {
  id: string;
  name: string;
  kind: ProviderProtocol;
  deployment?: string;
  apiVersion?: string;
  region?: string;
  headers?: Record<string, string>;
  modelCapabilities?: Record<string, Partial<Omit<ModelCapabilityDescriptor, 'model' | 'source'>>>;
  baseUrl: string;
  models: string[];
  imageModels: string[];
  observedModels: string[];
  observedAt: string | null;
  discovery: ModelDiscoveryOutcome;
  discoveryError: string | null;
  credentialId?: string | null;
  retiredCredentialIds?: string[];
  revision?: string;
}

function names(items: unknown, message: string): string[] {
  if (!Array.isArray(items) || items.length > 1000 || !items.every((item): item is string => typeof item === 'string' && item.trim().length > 0 && item.length <= 200)) throw new Error(message);
  return [...new Set(items.map((item) => item.trim()))];
}
function outcome(value: unknown): ModelDiscoveryOutcome {
  return value === 'success' || value === 'empty' || value === 'failed' || value === 'unknown' ? value : 'unknown';
}
function isoTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw new Error('Use at most 32 nonsecret headers.');
  const result: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    const key = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,120}$/.test(key) || typeof text !== 'string' || text.length > 2000 || /[\r\n]/.test(text)) throw new Error('Invalid request header.');
    if (['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'x-goog-api-key', 'cookie', 'set-cookie'].includes(key)) throw new Error('Enter authentication in the API key field, not nonsecret headers.');
    if (['host', 'content-length', 'connection', 'transfer-encoding'].includes(key) || Object.hasOwn(result, key)) throw new Error('Invalid or duplicate request header.');
    Object.defineProperty(result, key, { value: text, enumerable: true });
  }
  return result;
}

function parseCapabilities(value: unknown): ModelConnection['modelCapabilities'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1000) throw new Error('Invalid model capabilities.');
  const result: NonNullable<ModelConnection['modelCapabilities']> = {};
  for (const [model, facts] of Object.entries(value)) {
    names([model], 'Invalid capability model ID.');
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new Error('Invalid model capabilities.');
    const parsed: Record<string, unknown> = {};
    for (const [key, fact] of Object.entries(facts)) {
      if (key === 'contextWindow') { if (fact !== null && (!Number.isSafeInteger(fact) || Number(fact) <= 0)) throw new Error('Context window must be a positive integer or unknown.'); }
      else if (!['tools', 'vision', 'streaming', 'reasoning', 'structuredOutput', 'embedding', 'rerank', 'speech', 'stt', 'tts', 'image'].includes(key) || typeof fact !== 'string' || !['supported', 'unsupported', 'unknown'].includes(fact)) throw new Error('Invalid capability support.');
      parsed[key] = fact;
    }
    Object.defineProperty(result, model, { value: parsed, enumerable: true });
  }
  return result;
}

export function parseModelConnection(value: unknown): ModelConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A connection is required.');
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.id) || record.id === 'local-replay') throw new Error('Use a unique connection ID with lowercase letters, numbers and hyphens.');
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 120) throw new Error('A connection name is required.');
  if (typeof record.kind !== 'string' || !(['ollama', 'openai-compatible', 'openai-responses', 'azure-openai', 'anthropic', 'gemini'] as string[]).includes(record.kind)) throw new Error('Choose a supported provider protocol.');
  if (typeof record.baseUrl !== 'string' || record.baseUrl.length > 2000) throw new Error('An endpoint URL is required.');
  const url = new URL(record.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) endpoint without credentials, query parameters or fragments.');
  const observedAt = isoTimestamp(record.observedAt);
  const discovery = outcome(record.discovery);
  const discoveryError = typeof record.discoveryError === 'string' && record.discoveryError.length > 0 && record.discoveryError.length <= 300 ? record.discoveryError : null;
  const slot = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id);
  if (record.credentialId !== undefined && record.credentialId !== null && !slot(record.credentialId)) throw new Error('Invalid credential reference.');
  if (record.retiredCredentialIds !== undefined && (!Array.isArray(record.retiredCredentialIds) || record.retiredCredentialIds.length > 128 || !record.retiredCredentialIds.every(slot))) throw new Error('Invalid credential cleanup references.');
  if (record.revision !== undefined && (typeof record.revision !== 'string' || !/^[a-z0-9-]{1,80}$/.test(record.revision))) throw new Error('Invalid connection revision.');
  const headers = parseHeaders(record.headers);
  const modelCapabilities = parseCapabilities(record.modelCapabilities);
  return {
    id: record.id,
    name: record.name.trim(),
    kind: record.kind as ProviderProtocol,
    ...(typeof record.deployment === 'string' ? { deployment: record.deployment.slice(0, 200) } : {}),
    ...(typeof record.apiVersion === 'string' ? { apiVersion: record.apiVersion.slice(0, 100) } : {}),
    ...(typeof record.region === 'string' ? { region: record.region.slice(0, 100) } : {}),
    ...(headers ? { headers } : {}),
    ...(modelCapabilities ? { modelCapabilities } : {}),
    baseUrl: url.toString().replace(/\/$/, ''),
    models: names(record.models ?? [], 'Model IDs must be nonempty strings.'),
    imageModels: names(record.imageModels ?? [], 'Model IDs must be nonempty strings.'),
    observedModels: names(record.observedModels ?? [], 'Model IDs must be nonempty strings.'),
    observedAt,
    discovery,
    discoveryError,
    ...(record.credentialId !== undefined ? { credentialId: record.credentialId as string | null } : {}),
    ...(Array.isArray(record.retiredCredentialIds) ? { retiredCredentialIds: [...new Set(record.retiredCredentialIds as string[])] } : {}),
    ...(typeof record.revision === 'string' ? { revision: record.revision } : {})
  };
}

export function selectableModels(connection: Pick<ModelConnection, 'models' | 'observedModels'>): string[] {
  return [...new Set([...connection.observedModels, ...connection.models])];
}
export function discoverySummary(connection: Pick<ModelConnection, 'discovery' | 'discoveryError' | 'observedAt' | 'observedModels'>): string {
  if (connection.discovery === 'failed') return connection.discoveryError ?? 'The last discovery failed.';
  if (connection.discovery === 'empty') return 'Reached the endpoint but it returned no models. Your manual IDs are kept.';
  if (connection.discovery === 'success' && connection.observedAt) return `Last found ${connection.observedModels.length} model${connection.observedModels.length === 1 ? '' : 's'} on ${new Date(connection.observedAt).toLocaleString()}.`;
  return 'Not discovered yet.';
}
