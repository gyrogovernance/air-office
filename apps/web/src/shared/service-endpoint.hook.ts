import { STATIC_DEMO_SERVICE_BASE, staticDemoBuild } from '../static-demo/static-demo.flag';

/**
 * Resolves the AIR service endpoint once for every browser renderer. The native
 * desktop host publishes a random loopback endpoint before React renders; the
 * development browser keeps the fixed local discovery endpoint as its only
 * fallback. Demo mode uses a separate Demo-profile service.
 */
export const developmentServiceBase = import.meta.env?.VITE_OFFICE_SERVICE_BASE || 'http://127.0.0.1:4317';

export const demoServiceBase = import.meta.env?.VITE_OFFICE_DEMO_SERVICE_BASE || 'http://127.0.0.1:4329';

export const devSupervisorBase = import.meta.env?.VITE_OFFICE_DEV_SUPERVISOR_BASE || 'http://127.0.0.1:4330';

/** Browser Vite shell or packaged desktop — both may run Demo. */
export function demoModeAvailable(): boolean {
  if (staticDemoBuild()) return false;
  return Boolean(import.meta.env?.DEV) || Boolean(typeof window !== 'undefined' && window.airDesktop);
}

/** True when the user chose the isolated Demo workspace. */
export function demoModeRequested(): boolean {
  if (typeof window === 'undefined') return false;
  if (staticDemoBuild()) return false;
  // Unit tests can force Demo without Vite's import.meta.env.DEV injection.
  if ((window as Window & { __officeDemoForTests?: boolean }).__officeDemoForTests) return true;
  // `bun run dev:demo` points Vite at the Demo service and sets this flag.
  if (import.meta.env?.VITE_OFFICE_DEMO_MODE === '1') return true;
  return demoModeAvailable() && window.localStorage?.getItem('office.development.demo') === 'on';
}

let discovery: Promise<string> | null = null;
let readiness: Promise<string> | null = null;
/** Bumped on Retry / reset so clients drop bootstrap tokens from a dead service process. */
let sessionEpoch = 0;

/** How long the browser waits for `bun run dev` service bind after Vite reloads. */
export const SERVICE_READY_DEADLINE_MS = 60_000;
const SERVICE_READY_POLL_MS = 250;

export function serviceSessionEpoch(): number {
  return sessionEpoch;
}

export function currentServiceBase(): string | null {
  if (staticDemoBuild()) return STATIC_DEMO_SERVICE_BASE;
  if (demoModeRequested()) {
    if (typeof window !== 'undefined' && window.airDesktop) {
      return window.__AIR_SERVICE_BASE__ ?? null;
    }
    return demoServiceBase;
  }
  return typeof window !== 'undefined' && window.__AIR_SERVICE_BASE__ ? window.__AIR_SERVICE_BASE__ : null;
}

/** Clears cached discovery so Retry can wait for a restarted service again. */
export function resetServiceDiscovery(): void {
  discovery = null;
  readiness = null;
  sessionEpoch += 1;
  if (typeof window !== 'undefined') delete window.__AIR_SERVICE_BASE__;
}

export async function serviceIsReady(base: string, signal?: AbortSignal): Promise<boolean> {
  if (staticDemoBuild()) return base === STATIC_DEMO_SERVICE_BASE;
  try {
    const response = await fetch(`${base}/health`, { signal: signal ?? AbortSignal.timeout(3000), cache: 'no-store' });
    if (!response.ok) return false;
    const health: unknown = await response.json();
    if (!(typeof health === 'object' && health !== null && 'ready' in health && health.ready === true)) return false;
    if (!demoModeRequested()) return true;
    return 'demo' in health && health.demo === true;
  } catch { return false; }
}

async function startSelectedService(): Promise<string> {
  if (await serviceIsReady(demoServiceBase)) return demoServiceBase;
  // Vite can reconnect the page before the other development listeners bind.
  for (let attempt = 0; attempt < 20; attempt++) {
    const signal = AbortSignal.timeout(65_000);
    const response = await fetch(`${devSupervisorBase}/demo/start`, { method: 'POST', signal }).catch(() => null);
    if (response) {
      if (response.ok && await serviceIsReady(demoServiceBase)) return demoServiceBase;
      break;
    }
    if (signal.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Demo mode could not start. Try again.');
}

/**
 * Starts or waits for the Demo-profile service. Used by the Settings switch
 * before `office.development.demo` is written, so it must not depend on that flag.
 */
export async function ensureDemoServiceReachable(): Promise<string> {
  if (typeof window !== 'undefined' && window.airDesktop) {
    // Desktop Demo uses a random loopback port from start_demo_service — never 4329.
    const { desktopInvoke } = await import('../entry/desktop-host.adapter');
    const endpoint = await desktopInvoke<{ base: string }>('start_demo_service');
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.base)) {
      throw new Error('Demo mode could not start. Try again.');
    }
    window.__AIR_SERVICE_BASE__ = endpoint.base;
    if (!(await serviceIsReady(endpoint.base))) {
      throw new Error('Demo mode could not start. Try again.');
    }
    return endpoint.base;
  }
  readiness ??= startSelectedService().finally(() => { readiness = null; });
  return readiness;
}

export async function ensureServiceReachable(base: string): Promise<string> {
  if (staticDemoBuild()) return STATIC_DEMO_SERVICE_BASE;
  if (!demoModeRequested()) return base;
  if (typeof window !== 'undefined' && window.airDesktop) {
    if (await serviceIsReady(base)) return base;
    return ensureDemoServiceReachable();
  }
  readiness ??= startSelectedService().finally(() => { readiness = null; });
  return readiness;
}

/**
 * Waits until the development service answers /health, then bootstraps.
 * Vite often paints before 4317 is bound; failing once left the UI stuck on
 * "Connecting…" with empty agents/models. Opinionated: wait up to the deadline,
 * then fail loud with a clear reload instruction.
 */
export async function waitForDevelopmentService(base = developmentServiceBase, deadlineMs = SERVICE_READY_DEADLINE_MS): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  let lastDetail = '';
  while (Date.now() < deadline) {
    try {
      if (await serviceIsReady(base)) {
        const response = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173' }, cache: 'no-store' });
        if (!response.ok) throw new Error(`bootstrap HTTP ${response.status}`);
        const body = await response.json() as { serviceBase?: unknown };
        const resolved = typeof body.serviceBase === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.serviceBase) ? body.serviceBase : base;
        if (typeof window !== 'undefined') window.__AIR_SERVICE_BASE__ = resolved;
        return resolved;
      }
      lastDetail = 'service health not ready';
    } catch (reason) {
      lastDetail = reason instanceof Error ? reason.message : String(reason);
    }
    await new Promise((resolve) => setTimeout(resolve, SERVICE_READY_POLL_MS));
  }
  throw new Error(`AIR Office service did not become ready within ${Math.round(deadlineMs / 1000)}s (${lastDetail || 'no response'}). Keep \`bun run dev\` running, then Retry or reload.`);
}

export async function resolveServiceBase(): Promise<string> {
  if (staticDemoBuild()) return STATIC_DEMO_SERVICE_BASE;
  if (demoModeRequested()) {
    const published = currentServiceBase();
    if (published) return ensureServiceReachable(published);
    throw new Error('Demo mode could not start. Try again.');
  }
  const published = currentServiceBase();
  if (typeof window !== 'undefined' && window.airDesktop) {
    if (!published) throw new Error('The desktop service endpoint has not been published by the native host.');
    // Native host already published a live loopback base — do not poll 4317.
    return published;
  }
  // Browser Vite: wait for bun run dev to bind even when a stale base was cached.
  discovery ??= waitForDevelopmentService(developmentServiceBase).catch((error: unknown) => { discovery = null; throw error; });
  return discovery;
}
