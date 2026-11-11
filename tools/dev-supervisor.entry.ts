/** Development-only lifecycle requests on loopback. */
import { spawn, type Subprocess } from 'bun';
import { startDevRuntime, watchOwner, type DevRuntime } from './dev-runtime.adapter';

const DEMO_PORT = Number(process.env.OFFICE_DEMO_PORT ?? 4329);
const DEMO_BASE = `http://127.0.0.1:${DEMO_PORT}`;
const SUPERVISOR_PORT = Number(process.env.OFFICE_DEV_SUPERVISOR_PORT ?? 4330);

let demo: Subprocess | null = null;
let demoStarting: Promise<void> | null = null;
let lemonade: DevRuntime | null = null;
let lemonadeStarting: Promise<Record<string, string>> | null = null;

async function demoIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${DEMO_BASE}/health`, { signal: AbortSignal.timeout(1000), cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json() as { ready?: unknown; demo?: unknown };
    return body.ready === true && body.demo === true;
  } catch { return false; }
}

async function startDemo(): Promise<void> {
  if (await demoIsReady()) return;
  if (demo && demo.exitCode === null) {
    // A child we own is still starting; wait for it.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await demoIsReady()) return;
      if (typeof demo.exitCode === 'number') throw new Error('The demo service exited during startup.');
      await Bun.sleep(200);
    }
    throw new Error('The demo service did not become ready.');
  }
  demo = spawn([process.execPath, 'run', 'tools/demo.entry.ts', '--service-only'], {
    cwd: process.cwd(),
    env: { ...process.env, OFFICE_PORT: String(DEMO_PORT) },
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'ignore'
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await demoIsReady()) return;
    if (typeof demo.exitCode === 'number') throw new Error(`The demo service exited with code ${demo.exitCode}.`);
    await Bun.sleep(200);
  }
  throw new Error('The demo service did not become ready.');
}

function lemonadeEnvFrom(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const keys = [
    'OFFICE_LEMONADE_MODE',
    'OFFICE_LEMONADE_INSTANCE_ID',
    'OFFICE_LEMONADE_GENERATION',
    'OFFICE_LEMONADE_RELEASE',
    'OFFICE_LEMONADE_BASE_ORIGIN',
    'OFFICE_LEMONADE_TOKEN',
    'OFFICE_LEMONADE_MODELS_DIR',
  ] as const;
  const next: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) next[key] = value;
  }
  return next;
}

async function startLemonade(): Promise<Record<string, string>> {
  if (process.env.OFFICE_LEMONADE_BASE_ORIGIN) return lemonadeEnvFrom(process.env);
  if (lemonade?.environment.OFFICE_LEMONADE_BASE_ORIGIN) return lemonadeEnvFrom(lemonade.environment);
  const root = process.env.OFFICE_DATA_ROOT;
  if (!root) throw new Error('Local AI needs OFFICE_DATA_ROOT from the development server.');
  lemonade = await startDevRuntime({
    ...process.env,
    OFFICE_DATA_ROOT: root,
    ...(process.env.OFFICE_STORAGE_CONFIG ? { OFFICE_STORAGE_CONFIG: process.env.OFFICE_STORAGE_CONFIG } : {}),
    ...(process.env.OFFICE_RUNTIME_DIR ? { OFFICE_RUNTIME_DIR: process.env.OFFICE_RUNTIME_DIR } : {}),
    ...(process.env.OFFICE_FILES_ROOT ? { OFFICE_FILES_ROOT: process.env.OFFICE_FILES_ROOT } : {}),
    ...(process.env.OFFICE_DEFAULT_LOCAL_AI_DIR ? { OFFICE_DEFAULT_LOCAL_AI_DIR: process.env.OFFICE_DEFAULT_LOCAL_AI_DIR } : {}),
  });
  return lemonadeEnvFrom(lemonade.environment);
}

/** Loopback dev origins (Vite) are allowed to ask the supervisor. */
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin) ? origin : '';
  return allowed ? { 'access-control-allow-origin': allowed, vary: 'origin' } : {};
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers = cors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST, GET', ...headers } });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (url.pathname === '/health') {
    return json({
      ready: true,
      supervisor: true,
      demoRunning: Boolean(demo && demo.exitCode === null),
      lemonadeRunning: Boolean(lemonade?.environment.OFFICE_LEMONADE_BASE_ORIGIN),
    });
  }
  if (url.pathname === '/demo/start' && request.method === 'POST') {
    try {
      demoStarting ??= startDemo().finally(() => { demoStarting = null; });
      await demoStarting;
      return json({ base: DEMO_BASE });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'The demo service could not be started.' }, 500);
    }
  }
  if (url.pathname === '/lemonade/start' && request.method === 'POST') {
    try {
      lemonadeStarting ??= startLemonade().finally(() => { lemonadeStarting = null; });
      const environment = await lemonadeStarting;
      return json({ environment });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'The local AI runtime could not be started.' }, 500);
    }
  }
  return new Response('Not found', { status: 404, headers });
}

const server = Bun.serve({ hostname: '127.0.0.1', port: SUPERVISOR_PORT, idleTimeout: 120, fetch: route });

async function stop() {
  server.stop(true);
  if (demo && demo.exitCode === null) demo.kill('SIGKILL');
  if (demo) await demo.exited.catch(() => undefined);
  if (lemonade) await lemonade.stop();
  lemonade = null;
}
process.on('SIGINT', () => { void stop().then(() => process.exit(130)); });
process.on('SIGTERM', () => { void stop().then(() => process.exit(143)); });
// A terminal close or force kill reaches none of the signals above, so when
// the dev server that spawned us is gone we stop ourselves — taking the demo
// and local AI children down rather than orphaning them.
watchOwner(() => { void stop().then(() => process.exit(0)); });
