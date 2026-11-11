import { expect } from 'bun:test';
import type { Subprocess } from 'bun';
import { join } from 'node:path';

export type LaunchedService = {
  processHandle: Subprocess;
  port: number;
  base: string;
  token: string;
  stderrText: () => Promise<string>;
};

/** Spawns the service entrypoint and waits until /health answers. */
export async function launchService(options: {
  cwd?: string;
  env: Record<string, string | undefined>;
  attempts?: number;
  delayMs?: number;
}): Promise<LaunchedService> {
  const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = reservation.port;
  reservation.stop(true);
  const dataRoot = options.env.OFFICE_DATA_ROOT ?? (options.env.OFFICE_RUNTIME_DIR ? join(options.env.OFFICE_RUNTIME_DIR, 'service-data') : undefined);
  if (!dataRoot) throw new Error('Service tests require an isolated OFFICE_DATA_ROOT or OFFICE_RUNTIME_DIR.');
  const processHandle = Bun.spawn([process.execPath, 'src/application.entry.ts'], {
    cwd: options.cwd ?? join(import.meta.dir, '..', '..', 'apps', 'service'),
    env: { ...Bun.env, ...options.env, OFFICE_DATA_ROOT: dataRoot, OFFICE_STORAGE_CONFIG: options.env.OFFICE_STORAGE_CONFIG ?? join(dataRoot, 'storage-location.json'), OFFICE_PORT: String(port), DEV: String(Bun.env.DEV ?? 'false'), PROD: String(Bun.env.PROD ?? 'false'), SSR: String(Bun.env.SSR ?? 'false') },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const stderrPromise = new Response(processHandle.stderr as ReadableStream<Uint8Array>).text();
  const stdoutPromise = new Response(processHandle.stdout as ReadableStream<Uint8Array>).text();
  void stdoutPromise;
  const base = `http://127.0.0.1:${port}`;
  const attempts = options.attempts ?? 400;
  const delayMs = options.delayMs ?? 50;
  let ready = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`${base}/health`).catch(() => null);
    if (response?.ok) { ready = true; break; }
    if (processHandle.exitCode !== null) break;
    await Bun.sleep(delayMs);
  }
  if (!ready) {
    processHandle.kill();
    const stderr = await stderrPromise.catch(() => '');
    throw new Error(`Service failed to become ready on port ${port}.${stderr ? `\n${stderr.slice(0, 2000)}` : ''}`);
  }
  const bootstrap = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } });
  expect(bootstrap.ok).toBe(true);
  const token = (await bootstrap.json() as { token: string }).token;
  return {
    processHandle,
    port,
    base,
    token,
    stderrText: () => stderrPromise.catch(() => '')
  };
}

export async function stopService(processHandle: Subprocess | undefined): Promise<void> {
  processHandle?.kill();
  await processHandle?.exited;
}
