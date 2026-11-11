import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLemonadeResource } from '../apps/desktop/scripts/prepare-desktop-artifact.entry';

export const release = '2026.42.1';

/**
 * Initial context allocation for the assistant and its tool catalog.
 */
export const DEFAULT_CONTEXT_TOKENS = 16384;
export function hostTarget(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) return `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`;
  throw new Error('No pinned portable local AI artifact exists for this host. Configure an explicit attached endpoint.');
}

export function runtimeEnvironment(environment: NodeJS.ProcessEnv, key: string, models: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(environment).filter(([name]) => !name.startsWith('OFFICE_') && !name.startsWith('LEMONADE_') && !/TOKEN|API_KEY|SECRET|PASSWORD|^HF_|^HUGGING/iu.test(name)));
  const temporary = join(process.env.OFFICE_DATA_ROOT ?? '.tmp/data', 'cache', 'runtime-tmp');
  mkdirSync(temporary, { recursive: true });
  return { ...env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, LEMONADE_API_KEY: key, LEMONADE_DISABLE_BROADCAST: '1', HF_HOME: join(process.env.OFFICE_DATA_ROOT ?? '.tmp/data', 'cache', 'hf-home'), HF_HUB_CACHE: join(process.env.OFFICE_DATA_ROOT ?? '.tmp/data', 'cache', 'downloads'), LEMONADE_CACHE_DIR: join(process.env.OFFICE_DATA_ROOT ?? '.tmp/data', 'cache', 'runtime-cache') };
}

export function initializeConfig(state: string, models: string): void {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(models, { recursive: true, mode: 0o700 });
  const path = join(state, 'config.json');
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Local AI configuration must be an object.');
  // Preserve user options and explicit storage choices while enforcing private loopback startup.
  const config = { ...existing, host: '127.0.0.1', broadcast: false, log_level: 'none' };
  config.models_dir = existing.models_dir && existing.models_dir !== 'auto' ? existing.models_dir : models;
  if (!existsSync(path)) Object.assign(config, { auto_check_model_updates: false, inhibit_suspend: false, telemetry: { enabled: false } });
  // `-1` means "use the model file's native window". Small GGUFs ship with 4k,
  // which cannot hold AIR's Copilot tool catalog. Treat that sentinel as unset.
  // An explicit positive size the user chose is preserved.
  if (config.ctx_size === undefined || config.ctx_size === null || config.ctx_size === -1) {
    config.ctx_size = DEFAULT_CONTEXT_TOKENS;
  }
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function stopOwnedChild(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Only a still-owned live handle authorizes tree termination. Never target an attached endpoint.
    const killer = Bun.spawn(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    await killer.exited;
  }
  if (child.exitCode === null) child.kill('SIGKILL');
  await child.exited;
}

export interface DevRuntime { environment: NodeJS.ProcessEnv; child: ReturnType<typeof Bun.spawn> | null; stop(): Promise<void>; }

/** Whether a process is still running. A lock whose owner is gone is stale. */
function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * Watches the process that owns this one and fires `onGone` when it exits.
 *
 * Dev children are spawned by `dev.entry.ts` with `OFFICE_GUARD_PARENT_PID`
 * set to the dev server's pid. A normal stop delivers a signal or a stdin
 * end, but a terminal close or a force kill reaches none of them, so the
 * child would keep running with a dead parent. This watchdog is the
 * guaranteed fallback: when the owner is gone, the child stops itself.
 *
 * Returns a disposer that cancels the watch. No-op when there is no parent
 * pid or the platform cannot probe liveness.
 */
export function watchOwner(onGone: () => void, parentPid: number = Number(process.env.OFFICE_GUARD_PARENT_PID)): () => void {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return () => {};
  const watchdog = setInterval(() => {
    if (!processIsAlive(parentPid)) { clearInterval(watchdog); onGone(); }
  }, 1000);
  watchdog.unref();
  return () => clearInterval(watchdog);
}

/**
 * Lists our own runtime processes and their parent ids.
 *
 * The runtime tree is `lemond` spawning `llama-server` helpers. Bun does not
 * place a spawned child into an operating-system job object, so a terminal
 * that is closed or a dev server that is killed leaves the guard's child —
 * and its llama helpers — running with a dead parent. A later start reclaims
 * the lock, but without a sweep those orphans would keep serving forever.
 *
 * The sweep is deliberately narrow: it only ever touches executables that
 * live inside this workspace's own data directory. An executable outside the
 * data root belongs to a user-installed or attached runtime and is never
 * terminated, no matter what its name is.
 */
async function runtimeProcesses(): Promise<{ pid: number; parent: number; path: string }[]> {
  if (process.platform !== 'win32') return [];
  try {
    const query = "Get-CimInstance Win32_Process -Filter \"Name='lemond.exe' OR Name='llama-server.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress";
    const probe = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', query], { stdout: 'pipe', stderr: 'ignore' });
    const output = await new Response(probe.stdout).text();
    await probe.exited;
    const rows = JSON.parse(output || '[]') as { ProcessId: number; ParentProcessId: number; ExecutablePath: string | null } | { ProcessId: number; ParentProcessId: number; ExecutablePath: string | null }[];
    return (Array.isArray(rows) ? rows : [rows]).flatMap((row) => (row && row.ExecutablePath ? [{ pid: row.ProcessId, parent: row.ParentProcessId, path: row.ExecutablePath }] : []));
  } catch { return []; }
}

/**
 * Whether `path` is inside `root`. Both are normalised to a lower-case
 * trailing-separator form so a prefix match can never bleed into a sibling
 * directory that merely shares a name prefix.
 */
export function insideRoot(root: string, path: string): boolean {
  const base = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() + '/';
  const candidate = resolve(path).replace(/\\/g, '/').toLowerCase();
  return candidate.startsWith(base);
}

/**
 * Ends runtime processes under `root` whose owning parent is gone.
 *
 * A lemond or llama-server under our own data directory whose parent id no
 * longer resolves to a live process is an orphan of a previous run. We kill
 * the orphan's whole tree so its llama helpers go with it. Live-parented
 * processes are left alone, and anything outside `root` is never considered.
 */
export async function reapOrphanedRuntime(root: string): Promise<number[]> {
  const reaped: number[] = [];
  for (const proc of await runtimeProcesses()) {
    if (proc.pid === process.pid) continue;
    if (!insideRoot(root, proc.path)) continue;
    if (processIsAlive(proc.parent)) continue;
    if (process.platform === 'win32') {
      const killer = Bun.spawn(['taskkill.exe', '/PID', String(proc.pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
      await killer.exited;
      reaped.push(proc.pid);
    } else {
      try { process.kill(proc.pid, 'SIGKILL'); reaped.push(proc.pid); } catch { /* already gone */ }
    }
  }
  return reaped;
}

async function killPidTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    const killer = Bun.spawn(['taskkill.exe', '/PID', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore' });
    await killer.exited;
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

/**
 * Opinionated for `bun run dev`: the newest development run owns Local AI.
 *
 * Port reclaim alone is not enough — a previous `bun run dev` can keep the
 * models `owner.lock` while ports are already free, so the next start dies
 * with "already owned" and the UI looks empty. Before embedding Local AI,
 * kill the recorded owner (when alive), reap orphans under this data root,
 * and clear the lock so `claimOwnerLock` can succeed.
 *
 * Attached runtimes (`OFFICE_LEMONADE_BASE_ORIGIN`) never call this.
 */
export async function reclaimLocalAiOwnership(
  root: string,
  options?: { killTree?: (pid: number) => Promise<void>; isAlive?: (pid: number) => boolean }
): Promise<string | null> {
  const lock = join(root, 'models', 'owner.lock');
  const ownerFile = join(lock, 'owner.pid');
  const existing = (() => { try { return readFileSync(ownerFile, 'utf8').trim(); } catch { return ''; } })();
  const previous = Number(existing);
  const alive = options?.isAlive ?? processIsAlive;
  let reclaimed: string | null = null;
  if (existing && Number.isInteger(previous) && previous > 0 && previous !== process.pid && alive(previous)) {
    await (options?.killTree ?? killPidTree)(previous);
    reclaimed = `local AI owner (pid ${previous})`;
  }
  await reapOrphanedRuntime(root);
  rmSync(lock, { recursive: true, force: true });
  return reclaimed;
}

/**
 * Takes the exclusive owner lock for the local AI runtime.
 *
 * The lock is a directory, created exclusively. A previous run that was
 * killed rather than stopped leaves the directory behind, and an exclusive
 * create then fails forever, so the development server could never start
 * again without a manual deletion.
 *
 * The lock records the owning process id. A lock whose owner is gone is
 * reclaimed here. A lock whose owner is still alive fails closed — callers
 * that mean "newest `bun run dev` wins" must call `reclaimLocalAiOwnership`
 * first so takeover is explicit and logged.
 */
export function claimOwnerLock(lock: string, ownerPid: number = process.pid): void {
  const owner = join(lock, 'owner.pid');
  const existing = (() => { try { return readFileSync(owner, 'utf8').trim(); } catch { return ''; } })();
  const previous = Number(existing);
  if (existing && Number.isInteger(previous) && previous > 0 && previous !== ownerPid && processIsAlive(previous)) {
    throw new Error(`The local AI runtime is already owned by process ${previous}. Stop it before starting another.`);
  }
  // Either no owner is recorded, or the recorded owner is gone. Reclaim it.
  rmSync(lock, { recursive: true, force: true });
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(owner, String(ownerPid), { mode: 0o600 });
}

export async function startDevRuntime(environment: NodeJS.ProcessEnv = process.env): Promise<DevRuntime> {
  if (environment.OFFICE_LEMONADE_BASE_ORIGIN) return { environment: { ...environment, OFFICE_LEMONADE_MODE: 'attached' }, child: null, stop: async () => {} };
  // The guard's owner is always the dev server that spawned it, so the pid
  // is pinned last and can never be shadowed by an inherited value.
  const child = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), '--guard'], { env: { ...environment, OFFICE_GUARD_PARENT_PID: String(process.pid) }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let stopped: Promise<void> | undefined;
  const stop = () => stopped ??= (async () => {
    child.stdin.end();
    const finished = await Promise.race([child.exited.then(() => true), Bun.sleep(10000).then(() => false)]);
    if (!finished) await stopOwnedChild(child);
  })();
  let stderr = '';
  const reader = child.stderr.getReader();
  void (async () => { try { for (;;) { const part = await reader.read(); if (part.done) break; stderr += new TextDecoder().decode(part.value); } } catch { /* The guard is gone; its exit code is the report. */ } })();
  try {
    const output = child.stdout.getReader();
    let text = '';
    const descriptor = await Promise.race([
      (async () => {
        while (true) {
          const result = await output.read();
          if (result.done) throw new Error(`Local AI startup failed.${stderr.trim() ? ` ${stderr.trim()}` : ''}`);
          text += new TextDecoder().decode(result.value);
          if (text.length > 16384) throw new Error('Invalid private startup descriptor.');
          if (text.includes('\n')) return JSON.parse(text.trim()) as Record<string, string>;
        }
      })(),
      Bun.sleep(120000).then(() => { throw new Error('Local AI startup exceeded its two-minute deadline.'); })
    ]);
    output.releaseLock();
    return { environment: { ...environment, ...descriptor }, child, stop };
  } catch (error) { await stop(); throw error; }
}

async function guard(): Promise<void> {
  const root = resolve(process.env.OFFICE_DATA_ROOT ?? '.tmp/data');
  const lock = join(root, 'models', 'owner.lock');
  mkdirSync(join(root, 'models'), { recursive: true, mode: 0o700 });
  // Fail closed on a live owner; reclaim the lock of an owner that is gone.
  // Reclaiming also sweeps the orphans that dead owner left behind: a lemond
  // or llama-server under our own data root whose parent no longer exists.
  claimOwnerLock(lock);
  await reapOrphanedRuntime(root);
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const abort = new AbortController();
  let stopping: Promise<void> | undefined;
  // The lock is released only while this process still owns it, so a stopped
  // guard never removes a lock that a later owner has already taken.
  const releaseLock = () => {
    try {
      const owner = Number(readFileSync(join(lock, 'owner.pid'), 'utf8').trim());
      if (owner === process.pid) rmSync(lock, { recursive: true, force: true });
    } catch { /* The lock is already gone or unreadable; nothing to release. */ }
  };
  const stop = () => stopping ??= (async () => {
    abort.abort();
    if (child) await stopOwnedChild(child);
    // A stopped guard may still leave helpers the owned kill missed; sweep
    // once more so nothing under our data root outlives the run.
    await reapOrphanedRuntime(root);
    releaseLock();
  })();
  process.stdin.resume();
  process.stdin.on('end', () => { void stop().then(() => process.exit(0)); });
  process.on('SIGINT', () => { void stop().then(() => process.exit(130)); });
  process.on('SIGTERM', () => { void stop().then(() => process.exit(143)); });
  // The owning dev server is this guard's stdin writer, but a terminal close
  // or a force kill does not always deliver the end that stops us. Watch the
  // parent pid instead: when the dev server is gone, run the normal stop so
  // the whole runtime tree comes down with it.
  watchOwner(() => { void stop().then(() => process.exit(0)); });
  try {
    const target = hostTarget();
    const artifacts = join(root, `artifacts-${release}-${target}`);
    const executable = join(artifacts, 'lemonade', process.platform === 'win32' ? 'lemond.exe' : 'lemond');
    if (!existsSync(executable)) await prepareLemonadeResource(target, artifacts);
    abort.signal.throwIfAborted();
    const state = join(root, 'models', 'state');
    const models = join(root, 'models');
    initializeConfig(state, models);
    const port = await new Promise<number>((done, reject) => {
      const socket = createServer(); socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => { const address = socket.address(); socket.close(() => typeof address === 'object' && address ? done(address.port) : reject(new Error('No loopback port.'))); });
    });
    abort.signal.throwIfAborted();
    const key = randomBytes(32).toString('hex');
    const base = `http://127.0.0.1:${port}`;
    child = Bun.spawn([executable, state, '--port', String(port)], { cwd: state, env: runtimeEnvironment(process.env, key, models), stdout: 'ignore', stderr: 'pipe', stdin: 'ignore' });
    let childStderr = '';
    void (async () => {
      if (!child) return;
      const stderr = child.stderr;
      if (!stderr || typeof stderr === 'number' || typeof stderr.getReader !== 'function') return;
      const reader = stderr.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          childStderr += new TextDecoder().decode(result.value);
          if (childStderr.length > 8192) childStderr = childStderr.slice(-8192);
        }
      } catch { /* The owned child has exited. */ }
    })();
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null && !abort.signal.aborted) {
      try {
        const response = await fetch(`${base}/v1/health`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]), redirect: 'error' });
        if (response.ok && (await response.json()).status === 'ok' && child.exitCode === null) { ready = true; break; }
      } catch { /* Authenticated readiness remains bounded by the deadline and owned handle. */ }
      await Bun.sleep(100);
    }
    if (!ready) throw new Error(child.exitCode !== null
      ? `Local AI exited with code ${child.exitCode}.${childStderr.trim() ? ` ${childStderr.trim()}` : ''}`
      : 'Local AI failed authenticated readiness before the startup deadline.');
    process.stdout.write(JSON.stringify({ OFFICE_LEMONADE_MODE: 'embedded', OFFICE_LEMONADE_INSTANCE_ID: randomUUID(), OFFICE_LEMONADE_GENERATION: String(Date.now()), OFFICE_LEMONADE_RELEASE: release, OFFICE_LEMONADE_BASE_ORIGIN: base, OFFICE_LEMONADE_TOKEN: key, OFFICE_LEMONADE_MODELS_DIR: models }) + '\n');
    await child.exited;
  } finally { await stop(); }
}

if (import.meta.main && process.argv.includes('--guard')) {
  try { await guard(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Local AI startup failed.'}\n`);
    process.exitCode = 1;
  }
}
