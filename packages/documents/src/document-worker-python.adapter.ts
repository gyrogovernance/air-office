import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Windows Store `python.exe` stubs exit with code 49 and are not interpreters. */
function isWindowsStorePythonStub(interpreter: string): boolean {
  return /(?:^|[\\/])WindowsApps[\\/]/i.test(interpreter);
}

function venvInterpreter(workerRoot: string): string {
  return join(workerRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
}

const quiet = { stdout: 'ignore' as const, stderr: 'ignore' as const, timeout: 15_000 };

function probePython(interpreter: string): boolean {
  if (isWindowsStorePythonStub(interpreter)) return false;
  if (!existsSync(interpreter)) return false;
  try {
    const result = Bun.spawnSync([interpreter, '-c', 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 2)'], quiet);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function workerImportsOk(interpreter: string, workerRoot: string): boolean {
  try {
    const result = Bun.spawnSync([interpreter, '-c', 'import office_documents.main; import pypdfium2'], {
      cwd: workerRoot,
      env: { ...process.env, PYTHONPATH: join(workerRoot, 'src') },
      ...quiet,
      timeout: 30_000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function discoverSeedInterpreters(workerRoot: string, skip: string | null): string[] {
  const candidates: string[] = [];
  const push = (value: string | null | undefined) => {
    if (!value || value === skip || candidates.includes(value)) return;
    candidates.push(value);
  };

  push(Bun.env.OFFICE_PYTHON ?? null);

  // uv can download a toolchain on first find; keep it bounded and quiet so a
  // development host never blocks service startup on network work.
  try {
    const uv = Bun.which('uv');
    if (uv) {
      const found = Bun.spawnSync([uv, 'python', 'find', '>=3.11'], {
        cwd: workerRoot,
        env: { ...process.env, UV_NO_PROGRESS: '1', UV_PYTHON_DOWNLOADS: 'never' },
        stdout: 'pipe',
        stderr: 'ignore',
        timeout: 8_000,
      });
      if (found.exitCode === 0) {
        const line = found.stdout.toString('utf8').trim().split(/\r?\n/).find((entry) => entry.trim().length > 0);
        push(line?.trim() ?? null);
      }
    }
  } catch {
    /* ignore broken or hung uv */
  }

  for (const name of ['python3.15', 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3', 'python']) {
    push(Bun.which(name));
  }

  return candidates.filter((candidate) => probePython(candidate));
}

function createVenv(seed: string, venvPath: string, workerRoot: string): boolean {
  try {
    const uv = Bun.which('uv');
    if (uv) {
      const withUv = Bun.spawnSync([uv, 'venv', '--python', seed, venvPath], {
        cwd: workerRoot,
        env: { ...process.env, UV_NO_PROGRESS: '1', UV_PYTHON_DOWNLOADS: 'never' },
        ...quiet,
        timeout: 60_000,
      });
      if (withUv.exitCode === 0 && existsSync(venvInterpreter(workerRoot))) return true;
    }
  } catch {
    /* fall through to stdlib venv */
  }
  try {
    const withStdlib = Bun.spawnSync([seed, '-m', 'venv', venvPath], { cwd: workerRoot, ...quiet, timeout: 60_000 });
    return withStdlib.exitCode === 0 && existsSync(venvInterpreter(workerRoot));
  } catch {
    return false;
  }
}

function installWorkerDependencies(interpreter: string, workerRoot: string): boolean {
  try {
    const uv = Bun.which('uv');
    if (uv) {
      const withUv = Bun.spawnSync([uv, 'pip', 'install', '--python', interpreter, 'pypdfium2>=5'], {
        cwd: workerRoot,
        env: { ...process.env, UV_NO_PROGRESS: '1' },
        ...quiet,
        timeout: 120_000,
      });
      if (withUv.exitCode === 0) return true;
    }
  } catch {
    /* fall through to pip */
  }
  try {
    const withPip = Bun.spawnSync([interpreter, '-m', 'pip', 'install', 'pypdfium2>=5'], {
      cwd: workerRoot,
      ...quiet,
      timeout: 120_000,
    });
    return withPip.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Returns a Python interpreter that can run the managed documents worker when one
 * is already available (OFFICE_PYTHON, the worker .venv, or a real host Python).
 * Windows Store stubs are rejected.
 */
export function resolveDocumentWorkerPython(workerRoot: string): string | null {
  const override = Bun.env.OFFICE_PYTHON;
  if (override && probePython(override)) return override;

  const venv = venvInterpreter(workerRoot);
  if (existsSync(venv) && probePython(venv)) return venv;

  const seeds = discoverSeedInterpreters(workerRoot, null);
  return seeds[0] ?? null;
}

/**
 * Ensures the documents worker has a usable interpreter with pypdfium2 installed.
 * Creates or repairs `workers/documents/.venv` when the host has a real Python
 * (or uv) available. Returns null when no usable interpreter can be prepared.
 *
 * Development only. Packaged desktop builds must use the frozen documents
 * runtime and must not call this at startup.
 */
export function ensureDocumentWorkerPython(workerRoot: string): string | null {
  const override = Bun.env.OFFICE_PYTHON;
  if (override && probePython(override) && workerImportsOk(override, workerRoot)) return override;

  const venv = venvInterpreter(workerRoot);
  if (existsSync(venv) && probePython(venv) && workerImportsOk(venv, workerRoot)) return venv;

  const seeds = discoverSeedInterpreters(workerRoot, existsSync(venv) ? venv : null);
  const seed = seeds[0];
  if (!seed) return null;

  if (!createVenv(seed, join(workerRoot, '.venv'), workerRoot)) return null;
  if (!installWorkerDependencies(venv, workerRoot)) return null;
  if (!workerImportsOk(venv, workerRoot)) return null;
  return venv;
}
