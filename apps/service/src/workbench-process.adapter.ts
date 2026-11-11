import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  registerWorkbenchShellExtension,
  sealWorkbenchShellHtml,
  stageWorkbenchShellExtension,
  WORKBENCH_SHELL_EXTENSION_FOLDER,
  WORKBENCH_SHELL_EXTENSION_ID,
  workbenchShellExtensionRegistered,
  workbenchLaunchFromEnvironment,
  workbenchShellExtensionSourceRoot,
} from './workbench-file.adapter';

let child: ReturnType<typeof Bun.spawn> | null = null;
let lastError: string | null = null;
let starting: Promise<void> | null = null;

export function workbenchStartError(): string | null {
  return lastError ?? (Bun.env.OFFICE_CODE_SERVER_ERROR?.trim() || null);
}

function packageJsonNewer(sourceDir: string, targetDir: string): boolean {
  const source = join(sourceDir, 'package.json');
  const target = join(targetDir, 'package.json');
  if (!existsSync(source)) return false;
  if (!existsSync(target)) return true;
  return statSync(source).mtimeMs > statSync(target).mtimeMs;
}

function syncBundledExtensions(resourceRoot: string, extensionsDir: string): void {
  const bundled = join(resourceRoot, 'code-server', 'bundled-extensions');
  const shellSource = workbenchShellExtensionSourceRoot();
  const shellBundled = join(bundled, WORKBENCH_SHELL_EXTENSION_FOLDER);
  const alreadyStaged = existsSync(join(shellBundled, 'package.json'));
  // Avoid rewriting ~70MB of extensions on every Code open; refresh shell only when source changed.
  if (!alreadyStaged || packageJsonNewer(shellSource, shellBundled)) {
    try {
      stageWorkbenchShellExtension(bundled, shellSource);
    } catch (reason) {
      if (!alreadyStaged) {
        console.warn(JSON.stringify({
          component: 'workbench',
          status: 'shell-extension-missing',
          error: reason instanceof Error ? reason.message : 'stage failed',
        }));
      }
    }
  }
  if (!existsSync(bundled)) return;
  mkdirSync(extensionsDir, { recursive: true });
  for (const entry of readdirSync(bundled, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const from = join(bundled, entry.name);
    const target = join(extensionsDir, entry.name);
    const shell = entry.name.startsWith(`${WORKBENCH_SHELL_EXTENSION_ID}-`);
    if (existsSync(target) && (!shell || !packageJsonNewer(from, target))) continue;
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    cpSync(from, target, { recursive: true });
  }
  const shellFolder = join(extensionsDir, WORKBENCH_SHELL_EXTENSION_FOLDER);
  if (existsSync(join(shellFolder, 'package.json'))) {
    registerWorkbenchShellExtension(extensionsDir);
  }
}

/**
 * Stages, copies, and catalogs the AIR Office Code shell extension.
 * Returns whether the extension was missing from the catalog before this call
 * (a running code-server must restart to load it).
 */
export function ensureWorkbenchShellExtension(resourceRoot: string, dataDir: string): { needsRestart: boolean } {
  const extensionsDir = join(dataDir, 'extensions');
  const missing = !workbenchShellExtensionRegistered(extensionsDir);
  syncBundledExtensions(resourceRoot, extensionsDir);
  return { needsRestart: missing && workbenchShellExtensionRegistered(extensionsDir) };
}

/**
 * Resolve the code-server entry the same way the Windows `.cmd` launcher does:
 * `lib/node.exe <package-root> …args`. Spawning `code-server.cmd` goes through
 * `cmd.exe`, which re-parses the command line and breaks on spaces in paths
 * such as `…\AIR Office\resources\…`.
 */
function workbenchNodeCommand(packageRoot: string): { cmd: string[]; cwd: string } | null {
  const node = join(packageRoot, 'lib', 'node.exe');
  const unix = join(packageRoot, 'lib', 'node');
  if (process.platform === 'win32' && existsSync(node)) return { cmd: [node, packageRoot], cwd: packageRoot };
  if (existsSync(unix)) return { cmd: [unix, packageRoot], cwd: packageRoot };
  // Fall back to the shell scripts only when the bundled Node binary is absent.
  const script = process.platform === 'win32'
    ? join(packageRoot, 'bin', 'code-server.cmd')
    : join(packageRoot, 'bin', 'code-server');
  if (!existsSync(script)) return null;
  return { cmd: [script], cwd: packageRoot };
}

async function waitForWorkbenchReady(readyUrl: string, spawned: { exitCode: number | null }, stderr: () => string): Promise<'ready' | 'exited' | 'timeout'> {
  // Prefer fast failed probes: a 500ms timeout on every refused connection made
  // cold start feel much longer than the process itself needed.
  const deadline = Date.now() + 45_000;
  let delayMs = 40;
  while (Date.now() < deadline) {
    if (spawned.exitCode !== null) {
      if (stderr().trim()) console.warn(JSON.stringify({ component: 'workbench', status: 'exited', detail: stderr().trim().slice(0, 500) }));
      return 'exited';
    }
    try {
      const response = await fetch(readyUrl, { signal: AbortSignal.timeout(120), redirect: 'manual' });
      if (response.status < 500) return 'ready';
    } catch {
      /* still booting */
    }
    await Bun.sleep(delayMs);
    delayMs = Math.min(200, Math.floor(delayMs * 1.35));
  }
  if (stderr().trim()) console.warn(JSON.stringify({ component: 'workbench', status: 'timeout', detail: stderr().trim().slice(0, 500) }));
  return 'timeout';
}

async function startWorkbench(resourceRoot: string, dataDir: string): Promise<void> {
  lastError = null;
  if (workbenchLaunchFromEnvironment()) return;
  const packageRoot = join(resourceRoot, 'code-server');
  const launch = workbenchNodeCommand(packageRoot);
  if (!launch) {
    lastError = 'Code is not available on this computer.';
    return;
  }

  const startedAt = Date.now();
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 204 }) });
  const port = probe.port ?? 0;
  probe.stop(true);
  if (!port) {
    lastError = 'Code could not reserve a local port.';
    return;
  }

  // Loopback-only Code. Password auth + cookie handoff into the stage iframe
  // fails in Chromium (SameSite / Secure on http://127.0.0.1), which leaves a
  // blank white pane. Auth none is safe here: bound to 127.0.0.1 and started
  // only by AIR Office for the current profile.
  mkdirSync(join(dataDir, 'extensions'), { recursive: true });
  const syncAt = Date.now();
  syncBundledExtensions(resourceRoot, join(dataDir, 'extensions'));
  // Hide VS Code chat / secondary side bar chrome before the first page load.
  sealWorkbenchShellHtml(packageRoot);
  const config = join(dataDir, 'config.yaml');
  writeFileSync(config, `auth: none\ndisable-telemetry: true\ndisable-update-check: true\n`);
  const args = [
    '--config', config,
    '--bind-addr', `127.0.0.1:${port}`,
    '--auth', 'none',
    '--disable-telemetry',
    '--disable-update-check',
    '--ignore-last-opened',
    '--user-data-dir', dataDir,
    '--extensions-dir', join(dataDir, 'extensions'),
  ];
  const env: Record<string, string | undefined> = { ...Bun.env };
  delete env.PASSWORD;
  const spawnAt = Date.now();
  const spawned = Bun.spawn({
    cmd: [...launch.cmd, ...args],
    cwd: launch.cwd,
    env,
    stdout: 'ignore',
    stderr: 'pipe',
    windowsHide: true,
  });
  child = spawned;
  let stderr = '';
  void (async () => {
    const stream = spawned.stderr;
    if (!stream || typeof stream === 'number' || typeof stream.getReader !== 'function') return;
    const reader = stream.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        stderr += new TextDecoder().decode(part.value);
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      }
    } catch { /* process exited */ }
  })();

  const base = `http://127.0.0.1:${port}`;
  // Probe /login like the previous desktop host — bare / can lag while the
  // workbench finishes its first boot under a cold user-data directory.
  const ready = await waitForWorkbenchReady(`${base}/login`, spawned, () => stderr);
  if (ready === 'ready') {
    Bun.env.OFFICE_CODE_SERVER_URL = base;
    Bun.env.OFFICE_CODE_SERVER_DATA = dataDir;
    // No password cookie handoff when auth is none.
    delete Bun.env.OFFICE_CODE_SERVER_TOKEN;
    console.info(JSON.stringify({
      component: 'workbench',
      status: 'ready',
      auth: 'none',
      syncMs: spawnAt - syncAt,
      spawnMs: Date.now() - spawnAt,
      totalMs: Date.now() - startedAt,
      port,
    }));
    return;
  }
  try { spawned.kill(); } catch { /* already gone */ }
  if (child === spawned) child = null;
  lastError = ready === 'exited' ? 'Code stopped before it was ready.' : 'Code did not become ready.';
}

/** Starts the staged VS Code workspace when the desktop host has not already started it. */
export async function ensureDevWorkbench(resourceRoot: string, dataDir?: string): Promise<void> {
  if (workbenchLaunchFromEnvironment()) return;
  const resolvedDataDir = dataDir?.trim()
    || Bun.env.OFFICE_CODE_SERVER_DATA?.trim()
    || join(resourceRoot, '.code-server-data');
  starting ??= startWorkbench(resourceRoot, resolvedDataDir).finally(() => { starting = null; });
  await starting;
}

export function stopDevWorkbench(): void {
  try { child?.kill(); } catch { /* already gone */ }
  child = null;
  delete Bun.env.OFFICE_CODE_SERVER_URL;
  delete Bun.env.OFFICE_CODE_SERVER_DATA;
  delete Bun.env.OFFICE_CODE_SERVER_TOKEN;
}
