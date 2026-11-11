import { currentServiceBase, developmentServiceBase, ensureServiceReachable, resolveServiceBase, serviceSessionEpoch } from './service-endpoint.hook';

/**
 * Minimal authenticated client for the local AIR Office service.
 *
 * The service issues a per-process bootstrap token; this helper fetches it once
 * and reuses it. It never caches a provider credential, and every response it
 * returns is the nonsecret shape the service exposes.
 */
export interface ServiceClient {
  base: string;
  token: () => Promise<string>;
  json: <T>(path: string, init?: RequestInit) => Promise<T>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

/** Registered only by the static Pages bootstrap so product builds never import the snapshot. */
let staticDemoClientFactory: (() => ServiceClient) | null = null;

export function registerStaticDemoClient(factory: () => ServiceClient): void {
  staticDemoClientFactory = factory;
}

/** Cancelled fetches stay AbortError so callers can ignore remount/cleanup, not treat them as a down service. */
export function isAbortError(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === 'AbortError') return true;
  if (!(reason instanceof Error)) return false;
  return reason.name === 'AbortError' || /aborted/i.test(reason.message);
}

export function createServiceClient(base?: string): ServiceClient {
  if (import.meta.env.VITE_STATIC_DEMO === '1') {
    if (!staticDemoClientFactory) throw new Error('Static demo client was not registered.');
    return staticDemoClientFactory();
  }
  let resolvedBase: string | null = base ?? currentServiceBase();
  let cached: string | null = null;
  let epoch = serviceSessionEpoch();
  const resolveBase = async (): Promise<string> => {
    if (epoch !== serviceSessionEpoch()) { epoch = serviceSessionEpoch(); cached = null; resolvedBase = base ?? currentServiceBase(); }
    const published = base === undefined ? currentServiceBase() : null;
    if (published && published !== resolvedBase) { resolvedBase = published; cached = null; }
    try {
      // An endpoint given by the caller is used as it is; a discovered one is
      // resolved. Either way the guard reports a stopped service plainly.
      const reachable = base !== undefined && resolvedBase ? await ensureServiceReachable(resolvedBase) : await resolveServiceBase();
      resolvedBase = reachable;
      return reachable;
    } catch (reason) {
      if (isAbortError(reason)) throw reason;
      // A known reason, such as a demo service that is not running, says
      // what to do; only an unknown failure gets the generic advice.
      const detail = reason instanceof Error ? reason.message : '';
      throw new Error(detail || 'AIR Office service is unavailable. Start the service and reload.', { cause: reason });
    }
  };
  const token = async (): Promise<string> => {
    await resolveBase();
    if (cached && epoch === serviceSessionEpoch()) return cached;
    epoch = serviceSessionEpoch();
    cached = null;
    let response: Response;
    try {
      response = await fetch(`${await resolveBase()}/bootstrap`, { method: 'POST', headers: { origin: window.location.origin } });
    } catch (reason) {
      if (isAbortError(reason)) throw reason;
      const detail = reason instanceof Error && reason.message !== 'Failed to fetch' ? ` (${reason.message})` : '';
      throw new Error(`AIR Office service is unavailable${detail}. Start the service and reload`, { cause: reason });
    }
    if (!response.ok) throw new Error('AIR Office service is unavailable.');
    const body = await response.json() as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) throw new Error('AIR Office service returned an invalid session.');
    cached = body.token;
    return cached;
  };
    const send = async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${await token()}`);
      if (!(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
      try {
        return await fetch(`${await resolveBase()}${path}`, { ...init, headers });
      } catch (reason) {
        if (isAbortError(reason)) throw reason;
        const detail = reason instanceof Error && reason.message !== 'Failed to fetch' ? ` (${reason.message})` : '';
        throw new Error(`AIR Office service is unavailable${detail}. Start the service and reload.`, { cause: reason });
      }
    };
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await send(path, init);
    if (response.status !== 401) return response;
    // A restarted service issues a new bootstrap token, so the cached one is refreshed once.
    cached = null;
    return send(path, init);
  };
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await request(path, init);
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const detail = body && typeof body === 'object' && 'error' in body ? body.error : null;
      const message = typeof detail === 'string' ? detail : detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string' ? detail.message : `Service request failed (${response.status}).`;
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  };
  return { get base() { return resolvedBase ?? currentServiceBase() ?? developmentServiceBase; }, token, json, request };
}
