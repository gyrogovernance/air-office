import type { WebSearchProvider, WebSearchSettingsState } from '@office/contracts/capability';

export interface WebSearchSettingsStore {
  read(): { endpoint: string | null; enabled: boolean; options: WebSearchLoaderOptions; lastCheck: WebSearchCheckRecord | null };
  write(endpoint: string | null, options?: WebSearchLoaderOptions, enabled?: boolean): void;
  /** Records the outcome of the last reachability check, so the workspace can report it without asking again. */
  writeCheck(check: WebSearchCheckRecord | null): void;
  /** Releases the underlying storage so the workspace file can be moved or removed. */
  close(): void;
}

/**
 * How a request to the search service behaves. These are the loader controls a
 * person running their own search service needs: how long to wait, whether a
 * self-signed certificate is accepted, how many requests run at once, and
 * whether the service's own web loader is trusted to fetch a result.
 */
export interface WebSearchLoaderOptions {
  timeoutMs?: number;
  verifySsl?: boolean;
  maxConcurrentRequests?: number;
  bypassWebLoader?: boolean;
  trustProxyEnvironment?: boolean;
  /** Search region for the built-in engine (e.g. 'wt-wt' worldwide). Defaults to worldwide so results are not country-biased. */
  region?: string;
}

/** The loader options with their limits applied. */
export const WEB_SEARCH_LOADER_DEFAULTS: Required<WebSearchLoaderOptions> = {
  timeoutMs: 15_000,
  verifySsl: true,
  maxConcurrentRequests: 1,
  bypassWebLoader: false,
  trustProxyEnvironment: true,
  region: 'wt-wt'
};

export const WEB_SEARCH_LOADER_LIMITS = {
  timeoutMs: { min: 1_000, max: 120_000 },
  maxConcurrentRequests: { min: 1, max: 8 }
} as const;

/** Applies the limits to a partial set of loader options. */
export function normalizeWebSearchLoaderOptions(value: Partial<WebSearchLoaderOptions> | undefined): Required<WebSearchLoaderOptions> {
  const input = value ?? {};
  const timeout = Number(input.timeoutMs);
  const concurrency = Number(input.maxConcurrentRequests);
  const region = typeof input.region === 'string' && /^[a-z]{2,3}-[a-z]{2,4}$/i.test(input.region.trim()) ? input.region.trim().toLowerCase() : WEB_SEARCH_LOADER_DEFAULTS.region;
  return {
    timeoutMs: Number.isFinite(timeout) ? Math.min(Math.max(Math.trunc(timeout), WEB_SEARCH_LOADER_LIMITS.timeoutMs.min), WEB_SEARCH_LOADER_LIMITS.timeoutMs.max) : WEB_SEARCH_LOADER_DEFAULTS.timeoutMs,
    verifySsl: input.verifySsl === undefined ? WEB_SEARCH_LOADER_DEFAULTS.verifySsl : Boolean(input.verifySsl),
    maxConcurrentRequests: Number.isFinite(concurrency) ? Math.min(Math.max(Math.trunc(concurrency), WEB_SEARCH_LOADER_LIMITS.maxConcurrentRequests.min), WEB_SEARCH_LOADER_LIMITS.maxConcurrentRequests.max) : WEB_SEARCH_LOADER_DEFAULTS.maxConcurrentRequests,
    bypassWebLoader: input.bypassWebLoader === undefined ? WEB_SEARCH_LOADER_DEFAULTS.bypassWebLoader : Boolean(input.bypassWebLoader),
    trustProxyEnvironment: input.trustProxyEnvironment === undefined ? WEB_SEARCH_LOADER_DEFAULTS.trustProxyEnvironment : Boolean(input.trustProxyEnvironment),
    region
  };
}

/** Why a connection attempt ended. The reason is what the user acts on. */
export type WebSearchCheckReason = 'ok' | 'disabled' | 'unreachable' | 'unreadable';

/** The outcome of the last reachability check, kept so the workspace can report it. */
export interface WebSearchCheckRecord {
  reachable: boolean;
  reason: WebSearchCheckReason;
  detail: string | null;
  checkedAt: string;
}

export interface WebSearchSettingsOptions {
  store: WebSearchSettingsStore;
  /** Builds the provider for a service the user runs. Returns null when the endpoint cannot serve as one. */
  createProvider: (endpoint: string, options?: Required<WebSearchLoaderOptions>) => WebSearchProvider | null;
  /** Builds the built-in provider, which needs no key and no service the user has to run. */
  createBuiltInProvider: (options?: Required<WebSearchLoaderOptions>) => WebSearchProvider | null;
}

/** The settings the workspace can read and change. */
export interface WebSearchSettings {
  state(): WebSearchSettingsState;
  provider(): WebSearchProvider | null;
  save(value: unknown): Promise<WebSearchSettingsState>;
  check(): Promise<WebSearchSettingsState & { reachable: boolean; reason: WebSearchCheckReason; detail: string | null }>;
  close(): void;
}

export class WebSearchSettingsError extends Error {
  constructor(readonly code: 'invalid' | 'unreachable', message: string) { super(message); }
}

/**
 * The web search provider the workspace uses.
 *
 * Two engines are available. The built-in one needs no API key and no service
 * the user has to run, so web search works out of the box; the address of a
 * search service the user runs, such as a local SearXNG instance, is kept as
 * a stored setting for when they want their own.
 *
 * The endpoint is validated before it is stored: an endpoint that cannot
 * answer a search is a setup problem the user should see immediately, not a
 * failure that appears later inside a chat reply.
 *
 * Reachability is a separate fact from configuration. A provider can be
 * selected and still be unreachable, and the workspace reports that honestly
 * instead of claiming a working search.
 */
export function createWebSearchSettings(options: WebSearchSettingsOptions) {
  const loaderOptions = (): Required<WebSearchLoaderOptions> => normalizeWebSearchLoaderOptions(options.store.read().options);
  const builtInProvider = (): WebSearchProvider | null => {
    try { return options.createBuiltInProvider(loaderOptions()); } catch { return null; }
  };
  const state = (): WebSearchSettingsState => {
    const stored = options.store.read();
    const loader = loaderOptions();
    if (!stored.enabled) return { configured: false, enabled: false, provider: null, endpoint: stored.endpoint, builtIn: false, reachable: null, reason: 'disabled', detail: null, ...loader };
    if (stored.endpoint) {
      const provider = options.createProvider(stored.endpoint, loader);
      return { configured: provider !== null, enabled: true, provider: provider?.id ?? null, endpoint: stored.endpoint, builtIn: false, reachable: stored.lastCheck?.reachable ?? null, reason: stored.lastCheck?.reason ?? null, detail: stored.lastCheck?.detail ?? null, ...loader };
    }
    const provider = builtInProvider();
    return { configured: provider !== null, enabled: true, provider: provider?.id ?? null, endpoint: null, builtIn: true, reachable: stored.lastCheck?.reachable ?? null, reason: stored.lastCheck?.reason ?? null, detail: stored.lastCheck?.detail ?? null, ...loader };
  };
  const provider = (): WebSearchProvider | null => {
    const stored = options.store.read();
    if (!stored.enabled) return null;
    if (stored.endpoint) {
      try { return options.createProvider(stored.endpoint, loaderOptions()); } catch { return null; }
    }
    return builtInProvider();
  };
  const save = async (value: unknown): Promise<WebSearchSettingsState> => {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const loader = normalizeWebSearchLoaderOptions({
      ...loaderOptions(),
      ...(record?.timeoutMs !== undefined ? { timeoutMs: Number(record.timeoutMs) } : {}),
      ...(record?.verifySsl !== undefined ? { verifySsl: Boolean(record.verifySsl) } : {}),
      ...(record?.maxConcurrentRequests !== undefined ? { maxConcurrentRequests: Number(record.maxConcurrentRequests) } : {}),
      ...(record?.bypassWebLoader !== undefined ? { bypassWebLoader: Boolean(record.bypassWebLoader) } : {}),
      ...(record?.trustProxyEnvironment !== undefined ? { trustProxyEnvironment: Boolean(record.trustProxyEnvironment) } : {}),
      ...(record?.region !== undefined ? { region: String(record.region) } : {})
    });
    const enabled = record?.enabled === undefined ? true : Boolean(record.enabled);
    if (record && record.endpoint !== undefined && record.endpoint !== null && typeof record.endpoint !== 'string') {
      throw new WebSearchSettingsError('invalid', 'The search address must be text.');
    }
    const endpoint = record?.endpoint === null ? null : typeof record?.endpoint === 'string' && record.endpoint.trim() ? record.endpoint.trim() : undefined;
    if (endpoint === null) {
      // An empty address means the built-in engine, not "switched off". The
      // switch is the enabled flag, so the two settings cannot disagree.
      options.store.write(null, loader, enabled);
      options.store.writeCheck(null);
      return state();
    }
    if (endpoint !== undefined) {
      if (!/^https?:\/\//i.test(endpoint) || endpoint.length > 2000) throw new WebSearchSettingsError('invalid', 'Enter an http or https address for the search service.');
      const built = options.createProvider(endpoint, loader);
      if (!built) throw new WebSearchSettingsError('invalid', 'That address cannot serve search results.');
      options.store.write(endpoint, loader, enabled);
      options.store.writeCheck(null);
      return state();
    }
    const current = options.store.read();
    options.store.write(current.endpoint, loader, enabled);
    return state();
  };
  // A connection check reports why it failed, not only that it failed. A
  // provider that answers nothing, a provider that answers with something
  // other than search results, and a search that is switched off are three
  // different problems and each needs a different fix.
  const check = async (): Promise<WebSearchSettingsState & { reachable: boolean; reason: WebSearchCheckReason; detail: string | null }> => {
    const stored = options.store.read();
    if (!stored.enabled) return { ...state(), reachable: false, reason: 'disabled', detail: 'Web search is switched off for this workspace.' };
    const current = provider();
    if (!current) return { ...state(), reachable: false, reason: 'unreachable', detail: 'No search provider could be built for this workspace.' };
    try {
      const response = await current.search('air office', { limit: 1 });
      if (!response.results.length) {
        const record: WebSearchCheckRecord = { reachable: false, reason: 'unreadable', detail: 'The search engine answered with no readable results. It may not support this search format.', checkedAt: new Date().toISOString() };
        options.store.writeCheck(record);
        return { ...state(), ...record };
      }
      const record: WebSearchCheckRecord = { reachable: true, reason: 'ok', detail: null, checkedAt: new Date().toISOString() };
      options.store.writeCheck(record);
      return { ...state(), ...record };
    } catch (reason) {
      const record: WebSearchCheckRecord = { reachable: false, reason: 'unreachable', detail: reason instanceof Error ? reason.message : 'The search engine could not be reached.', checkedAt: new Date().toISOString() };
      options.store.writeCheck(record);
      return { ...state(), ...record };
    }
  };
  return { state, provider, save, check, close: () => options.store.close() };
}
