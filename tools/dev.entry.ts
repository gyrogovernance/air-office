import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { reclaimLocalAiOwnership, stopOwnedChild, watchOwner, type DevRuntime } from './dev-runtime.adapter';
import { prepareStorageLocation } from '../packages/runtime/src/runtime.service.public';
import { prepareWebSearchWorker } from './prepare-web-search.entry';
import { printCliBanner } from './cli-banner';

type Child = ReturnType<typeof Bun.spawn>;

const children: Child[] = [];
let stopping = false;
let runtime: DevRuntime | undefined;

// Every dev child — service, web, guard, supervisor, demo — inherits this so
// it can detect when the dev server died and stop itself. Each child pins its
// own immediate parent, so a grandchild watches its real owner, never a
// grandparent that may outlive the link in between.
process.env.OFFICE_GUARD_PARENT_PID = String(process.pid);

function start(command: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Child {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit'
  });
  children.push(child);
  return child;
}

async function stop(exitCode: number): Promise<never> {
  if (stopping) return await new Promise<never>(() => undefined);
  stopping = true;
  await Promise.allSettled(children.map(stopOwnedChild));
  await runtime?.stop();
  // A force kill or a wedged child can leave a loopback listener behind that
  // the owned kill never reached. Sweep the known dev ports once more so no
  // AIR Office listener outlives the run; foreign processes are never matched.
  await reclaimStaleInstances();
  process.exit(exitCode);
}

process.on('SIGINT', () => { void stop(130); });
process.on('SIGTERM', () => { void stop(143); });

/**
 * Finds the PID listening on a loopback port via `netstat -ano`. Returns null
 * when nothing is bound or netstat is unavailable.
 */
async function pidOnPort(port: number): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      const probe = Bun.spawn(['netstat.exe', '-ano', '-p', 'tcp'], { stdout: 'pipe', stderr: 'ignore' });
      const output = await new Response(probe.stdout).text();
      await probe.exited;
      const marker = `:${port}`;
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const columns = line.trim().split(/\s+/);
        // columns: TCP  127.0.0.1:4317  0.0.0.0:0  LISTENING  12345
        if (columns.length >= 5 && columns[1].endsWith(marker) && (columns[1].startsWith('127.0.0.1') || columns[1].startsWith('0.0.0.0') || columns[1].startsWith('[::1]'))) {
          const pid = Number(columns[4]);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
      return null;
    }
    const probe = Bun.spawn(['lsof', `-nP`, `-iTCP:${port}`, `-sTCP:LISTEN`, `-t`], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const output = (await new Response(probe.stdout).text()).trim();
    await probe.exited;
    const pid = Number(output.split(/\n/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Stale packaged sidecars that hold the shared data directory. */
async function reclaimOrphanSidecars(): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    const probe = Bun.spawn(['pgrep', '-f', 'air-office-service'], { stdout: 'pipe', stderr: 'ignore' });
    const output = (await new Response(probe.stdout).text()).trim();
    await probe.exited;
    if (!output) return;
    const killed: string[] = [];
    for (const line of output.split(/\n/)) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      await killPidTree(pid);
      killed.push(String(pid));
    }
    if (killed.length) console.info(`Reclaimed orphan sidecars: ${killed.join(', ')}.`);
  } catch {
    /* ignore */
  }
}

/** Whether the port holds an AIR Office service we own. */
async function isAirOfficeService(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json() as { protocol?: unknown; ready?: unknown };
    return body.protocol === 1 && body.ready === true;
  } catch { return false; }
}

/** Whether the port holds a Vite dev server we own (AIR Office web dev). */
async function isViteDevServer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes('/@vite/client') || html.includes('air-office');
  } catch { return false; }
}

/** Whether the port holds our dev supervisor. */
async function isDevSupervisor(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json() as { supervisor?: unknown };
    return body.supervisor === true;
  } catch { return false; }
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
 * Reclaims ports owned by previous dev runs that were never shut down.
 *
 * A terminal that was closed, an agent that stopped without cleanup, or a
 * crash can leave the service, web server, demo service or supervisor bound.
 * The next `bun run dev` would collide with them, so we find each owner by
 * PID and end its tree — but only after confirming the listener really is an
 * AIR Office piece, so an unrelated process on the same port is left alone.
 */
async function reclaimStaleInstances(): Promise<void> {
  // Fixed route only: service 4317, demo 4329, web 5173, supervisor 4330.
  // Also clear Vite hop leftovers (5174/5175) so a prior race cannot leave a
  // second origin alive after the next start takes 5173.
  const candidates: { port: number; check: () => Promise<boolean>; name: string }[] = [
    { port: 4317, check: () => isAirOfficeService(4317), name: 'service' },
    { port: 4329, check: () => isAirOfficeService(4329), name: 'demo service' },
    { port: 5173, check: () => isViteDevServer(5173), name: 'web dev server' },
    { port: 5174, check: () => isViteDevServer(5174), name: 'web hop 5174' },
    { port: 5175, check: () => isViteDevServer(5175), name: 'web hop 5175' },
    { port: 4330, check: () => isDevSupervisor(4330), name: 'dev supervisor' }
  ];
  const reclaimed: string[] = [];
  for (const { port, check, name } of candidates) {
    const pid = await pidOnPort(port);
    if (pid === null || pid === process.pid) continue;
    if (!(await check())) continue;
    await killPidTree(pid);
    reclaimed.push(`${name} (pid ${pid})`);
    // Give the OS a moment to release the socket before we bind it.
    await Bun.sleep(150);
  }
  if (reclaimed.length) console.info(`Reclaimed stale dev processes: ${reclaimed.join(', ')}.`);
}

const bun = process.execPath;
printCliBanner();
prepareWebSearchWorker();
await reclaimStaleInstances();
const native = process.argv.includes('--native');
let processes: { name: string; child: Child }[];
if (native) {
  await reclaimOrphanSidecars();
  const target = process.platform === 'win32' && process.arch === 'x64' ? 'x86_64-pc-windows-msvc' : process.platform === 'darwin' && process.arch === 'arm64' ? 'aarch64-apple-darwin' : process.platform === 'darwin' ? 'x86_64-apple-darwin' : process.platform === 'linux' ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu` : null;
  const plain = resolve(`apps/desktop/binaries/air-office-service${process.platform === 'win32' ? '.exe' : ''}`);
  const triple = target ? resolve(`apps/desktop/binaries/air-office-service-${target}${process.platform === 'win32' ? '.exe' : ''}`) : null;
  const executable = [plain, triple].find((path) => path && existsSync(path)) ?? null;
  if (!executable) throw new Error('Native development requires a staged service for this host. Run prepare-desktop-artifact once, then reuse its files.');
  const runtime = resolve(`apps/desktop/resources/lemonade/lemond${process.platform === 'win32' ? '.exe' : ''}`);
  if (!existsSync(runtime)) throw new Error('Native development requires the staged local runtime. Run prepare-desktop-artifact once, or use browser development with an explicitly attached runtime.');
  process.env.OFFICE_SERVICE_EXECUTABLE = executable;
  process.env.OFFICE_DEV_URL = 'http://127.0.0.1:5173';
  // Electron loads Vite; Vite is started by electron-vite via OFFICE_DEV_URL wait, or we start it here.
  processes = [
    { name: 'web', child: start([bun, 'run', '--silent', 'dev'], 'apps/web') },
    { name: 'desktop', child: start([bun, 'run', 'dev'], 'apps/desktop') },
  ];
} else {
  // Optional OFFICE_LEMONADE_BASE_ORIGIN and OFFICE_LEMONADE_TOKEN attach an existing runtime.
  const root = resolve(process.env.OFFICE_DATA_ROOT ?? join(process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '.', '.local', 'share'), 'AIR Office', 'Data'));
  const storageConfig = resolve(process.env.OFFICE_STORAGE_CONFIG ?? join(root, 'private', 'storage-location.json'));
  const legacy = {
    workspace: resolve(process.env.OFFICE_RUNTIME_DIR ?? join(root, 'private', 'workspace')),
    files: resolve(process.env.OFFICE_FILES_ROOT ?? join(root, 'private', 'files')),
    localAi: resolve(process.env.OFFICE_DEFAULT_LOCAL_AI_DIR ?? join(root, 'models'))
  };
  const defaults = { private: join(root, 'private'), public: join(root, 'public'), models: join(root, 'models'), cache: join(root, 'cache'), ...legacy };
  const storage = await prepareStorageLocation(storageConfig, defaults);
  const runtimeRoot = join(storage.private!, 'workspace');
  // Newest bun run dev wins Local AI: clear a live previous owner before a later on-demand start.
  const localAi = await reclaimLocalAiOwnership(root);
  if (localAi) console.info(`Reclaimed stale local AI: ${localAi}.`);
  // Lemonade and Code start on demand (like Demo), not with every `bun run dev`.
  const serviceEnv = {
    ...process.env,
    OFFICE_DATA_ROOT: root,
    OFFICE_STORAGE_CONFIG: storageConfig,
    OFFICE_RUNTIME_DIR: runtimeRoot,
    OFFICE_FILES_ROOT: join(storage.private!, 'files'),
    OFFICE_DEFAULT_LOCAL_AI_DIR: storage.models!,
    OFFICE_DEV_LAZY_LEMONADE: process.env.OFFICE_LEMONADE_BASE_ORIGIN ? '0' : '1',
  };
  const supervisorEnv = { ...serviceEnv };
  processes = [
    { name: 'service', child: start([bun, 'run', '--silent', 'src/application.entry.ts'], 'apps/service', serviceEnv) },
    { name: 'web', child: start([bun, 'run', '--silent', 'dev'], 'apps/web') },
    { name: 'dev supervisor', child: start([bun, 'run', '--silent', 'tools/dev-supervisor.entry.ts'], '.', supervisorEnv) },
  ];
}
const finished = await Promise.race(processes.map(({ name, child }) => child.exited.then((code) => ({ name, code }))));

if (!stopping) {
  console.error(`AIR Office ${finished.name} process exited${finished.code === null ? '' : ` with code ${finished.code}`}.`);
  await stop(finished.code && finished.code > 0 ? finished.code : 1);
}

await new Promise<never>(() => undefined);
