import type { ModelConnection, ModelDiscoveryOutcome } from './providers.domain.public';
import { CHAT_REASONING_EFFORTS, isChatReasoningEffort, type ModelReasoningOptions, type ProviderModelList } from '@office/contracts/chat';

export interface ModelListRequest {
  kind: ModelConnection['kind'] | 'chatgpt-signin';
  baseUrl: string;
  headers?: Record<string, string>;
  /** Resolves the bearer token for this connection at call time, or null when the endpoint needs no credential. */
  credential?: () => Promise<string | null>;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  /** Deadline for the listing request. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export type ModelListResult = ProviderModelList;
export type ModelListSuccess = Extract<ModelListResult, { ok: true }>;
export type ModelListFailure = Extract<ModelListResult, { ok: false }>;

function pickChatGptReasoning(record: Record<string, unknown>): ModelReasoningOptions | null {
  const levelsRaw = record.supported_reasoning_levels;
  if (!Array.isArray(levelsRaw) || levelsRaw.length === 0 || levelsRaw.length > 20) return null;
  const levels = [...new Set(levelsRaw.flatMap((item) => {
    const effort = item && typeof item === 'object' ? (item as { effort?: unknown }).effort : item;
    return isChatReasoningEffort(effort) ? [effort] : [];
  }))];
  if (!levels.length) return null;
  const fallback = levels.includes('medium') ? 'medium' : levels[0]!;
  const defaultLevel = isChatReasoningEffort(record.default_reasoning_level) && levels.includes(record.default_reasoning_level)
    ? record.default_reasoning_level
    : fallback;
  return { levels: CHAT_REASONING_EFFORTS.filter((level) => levels.includes(level)), defaultLevel };
}

function pickIds(kind: ModelListRequest['kind'], body: unknown): { ids: string[]; reasoningByModel?: Record<string, ModelReasoningOptions> } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const list = kind === 'ollama' || kind === 'gemini' || kind === 'chatgpt-signin' ? record.models : record.data;
  if (!Array.isArray(list) || list.length > 1000) return null;
  const ids: string[] = [];
  const reasoningByModel: Record<string, ModelReasoningOptions> = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (kind === 'chatgpt-signin' && record.visibility !== 'list') continue;
    const id = kind === 'ollama' ? record.name : kind === 'chatgpt-signin' ? record.slug : kind === 'gemini' ? record.name : record.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 200) return null;
    const trimmed = id.trim();
    ids.push(trimmed);
    if (kind === 'chatgpt-signin') {
      const reasoning = pickChatGptReasoning(record);
      if (reasoning) reasoningByModel[trimmed] = reasoning;
    }
  }
  return { ids, ...(kind === 'chatgpt-signin' && Object.keys(reasoningByModel).length ? { reasoningByModel } : {}) };
}

/** Bound the response before JSON expansion, and keep the deadline active through body reads. */
async function listingBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  let complete = false;
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) { complete = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('Model list exceeds response budget');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { signal.removeEventListener('abort', abort); if (!complete) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function failureForStatus(status: number): ModelListFailure {
  if (status === 401 || status === 403) return { ok: false, reason: 'auth', status, message: `The endpoint rejected the credential (HTTP ${status}). Check the API key.` };
  if (status === 404) return { ok: false, reason: 'not-found', status, message: `The endpoint did not expose a model list (HTTP ${status}). Confirm the URL and that model discovery is supported.` };
  return { ok: false, reason: 'http', status, message: `The endpoint returned HTTP ${status}.` };
}

/**
 * The single owner of listing the models a connection currently exposes. Both the
 * settings discovery route and the provider catalogue call this, so URL building,
 * the bearer token, timeouts and error classification stay identical and a
 * reachable-but-empty endpoint is reported as success rather than silently
 * replaced by configured IDs.
 */
export async function listConnectionModels(request: ModelListRequest): Promise<ModelListResult> {
  if (request.kind === 'azure-openai') return { ok: false, reason: 'not-found', message: 'Azure deployments do not expose a portable model catalogue. Enter the deployment model ID manually.' };
  const fetchImpl = request.fetchImpl ?? fetch;
  let token: string | null;
  try { token = request.credential ? await request.credential() : null; }
  catch { return { ok: false, reason: 'auth', message: 'The saved credential could not be read. Check credential storage and retry.' }; }
  const headers: Record<string, string> = {
    'content-type': 'application/json', ...request.headers,
    ...(request.kind === 'anthropic' ? { 'anthropic-version': request.headers?.['anthropic-version'] ?? '2023-06-01', ...(token ? { 'x-api-key': token } : {}) }
      : request.kind === 'gemini' ? (token ? { 'x-goog-api-key': token } : {})
        : token ? { authorization: 'Bearer ' + token } : {})
  };
  const deadline = AbortSignal.timeout(request.timeoutMs ?? 15000);
  const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline;
  const address = new URL(request.baseUrl.replace(/\/$/, '') + (request.kind === 'ollama' ? '/api/tags' : '/models'));
  if (request.kind === 'gemini') address.searchParams.set('pageSize', '1000');
  if (request.kind === 'anthropic') address.searchParams.set('limit', '1000');
  const models: string[] = [];
  const reasoningByModel: Record<string, ModelReasoningOptions> = {};
  const cursors = new Set<string>();
  const invalid = (): ModelListFailure => ({ ok: false, reason: 'parse', message: 'The endpoint returned an invalid or oversized model list. Enter model IDs manually if its catalogue cannot be listed completely.' });
  for (let page = 0; page < 20; page++) {
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await fetchImpl(address.href, { headers, signal });
    } catch {
      if (request.signal?.aborted) return { ok: false, reason: 'network', message: 'The listing was cancelled.' };
      return deadline.aborted ? { ok: false, reason: 'timeout', message: 'The endpoint did not respond in time.' } : { ok: false, reason: 'network', message: 'Could not reach the endpoint. Check the URL and that the server is running.' };
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return failureForStatus(response.status); }
    let body: unknown;
    try { body = await listingBody(response, signal); }
    catch {
      if (request.signal?.aborted) return { ok: false, reason: 'network', message: 'The listing was cancelled.' };
      if (deadline.aborted) return { ok: false, reason: 'timeout', message: 'The endpoint did not respond in time.' };
      return { ok: false, reason: 'parse', message: 'The endpoint did not return valid JSON.' };
    }
    const pageModels = pickIds(request.kind, body);
    if (pageModels === null || models.length + pageModels.ids.length > 1000) return invalid();
    models.push(...pageModels.ids);
    if (pageModels.reasoningByModel) Object.assign(reasoningByModel, pageModels.reasoningByModel);
    const record = body as Record<string, unknown>;
    const cursor = request.kind === 'gemini' ? record.nextPageToken : request.kind === 'anthropic' && record.has_more === true ? record.last_id : undefined;
    if (cursor === undefined || cursor === null || cursor === '') {
      if (request.kind === 'anthropic' && record.has_more === true) return invalid();
      if (request.kind !== 'anthropic' && request.kind !== 'gemini' && (record.has_more === true || record.nextPageToken)) return invalid();
      return { ok: true, models: [...new Set(models)], empty: models.length === 0, ...(Object.keys(reasoningByModel).length ? { reasoningByModel } : {}) };
    }
    if (typeof cursor !== 'string' || cursor.length > 2000 || cursors.has(cursor)) return invalid();
    cursors.add(cursor);
    address.searchParams.set(request.kind === 'gemini' ? 'pageToken' : 'after_id', cursor);
  }
  return invalid();
}

/** Maps a listing result to the outcome stored on a connection. */
export function outcomeForResult(result: ModelListResult): ModelDiscoveryOutcome {
  if (!result.ok) return 'failed';
  return result.empty ? 'empty' : 'success';
}
