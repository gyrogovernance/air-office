import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const { values } = parseArgs({ args: process.argv.slice(2), options: { service: { type: 'string' }, resources: { type: 'string' } }, strict: true });
if (!values.service || !values.resources) throw new Error('Usage: bun run apps/desktop/scripts/verify-desktop-service.entry.ts --service <compiled-service> --resources <resources-directory>');
const executable = resolve(values.service);
const resources = resolve(values.resources);
if (!existsSync(executable) || !existsSync(join(resources, 'lab-pack', 'data', 'workspace-v1.json'))) throw new Error('The compiled service and packaged seed resources are required.');
const temporaryRoot = resolve('.tmp');
mkdirSync(temporaryRoot, { recursive: true });
const dataRoot = mkdtempSync(join(temporaryRoot, 'desktop-service-verification-'));
const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
const port = reservation.port;
reservation.stop(true);
const instanceId = `desktop-verification-${randomUUID()}`;
const base = `http://127.0.0.1:${port}`;
const origin = 'air-office://localhost';
// Explicitly exclude inherited AIR settings, provider keys and host Python.
const environment: Record<string, string> = {};
for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
  const value = process.env[name];
  if (value) environment[name] = value;
}
Object.assign(environment, {
  PATH: '', PYTHONHOME: '', PYTHONPATH: '',
  OFFICE_DATA_ROOT: dataRoot,
  OFFICE_STORAGE_CONFIG: join(dataRoot, 'storage-location.json'),
  OFFICE_RESOURCE_ROOT: resources,
  OFFICE_PORT: String(port),
  OFFICE_SERVICE_INSTANCE_ID: instanceId,
  OFFICE_PUBLIC_SERVICE_BASE: base,
  OFFICE_LAB_PACK: 'true',
});
const child = spawn(executable, [], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.resume();
child.stderr.resume();
let launchFailed = false;
child.on('error', () => { launchFailed = true; });
const closed = new Promise<void>((resolveClosed) => { child.once('close', () => resolveClosed()); });
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
const request = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(3000) });
const healthSchema = z.object({ ready: z.literal(true), demo: z.literal(false), instanceId: z.string() });
const bootstrapSchema = z.object({ token: z.string().min(1) });
const methodsSchema = z.object({ definitions: z.array(z.object({ value: z.object({ id: z.string() }) })) });
const collectionsSchema = z.object({ collections: z.array(z.object({ id: z.string() })) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    check(!launchFailed && child.exitCode === null, 'The compiled service exited before becoming ready.');
    const response = await request('/health').catch(() => null);
    if (response?.ok) {
      const parsed = healthSchema.safeParse(await response.json());
      ready = parsed.success && parsed.data.instanceId === instanceId;
      if (ready) break;
    }
    await Bun.sleep(250);
  }
  check(ready, 'The compiled service did not become healthy within its startup deadline.');
  const bootstrap = await request('/bootstrap', { method: 'POST', headers: { origin } });
  check(bootstrap.status === 200 && bootstrap.headers.get('access-control-allow-origin') === origin, 'Windows desktop bootstrap or its CORS policy failed.');
  const token = bootstrapSchema.parse(await bootstrap.json()).token;
  const headers = { origin, authorization: `Bearer ${token}` };
  const methodsResponse = await request('/api/v1/methods', { headers });
  check(methodsResponse.status === 200 && methodsResponse.headers.get('access-control-allow-origin') === origin, 'Authenticated methods are unavailable to the desktop.');
  const methods = methodsSchema.parse(await methodsResponse.json());
  const methodIds = new Set(methods.definitions.map((definition) => definition.value.id));
  check(methodIds.has('lab-agent-claim-evidence') && methodIds.has('lab-skill-the-human-mark'), 'The packaged starter methods were not installed.');
  let collectionIds = new Set<string>();
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await request('/api/v1/collections', { headers });
    check(response.status === 200, 'Authenticated starter collections are unavailable.');
    collectionIds = new Set(collectionsSchema.parse(await response.json()).collections.map((collection) => collection.id));
    if (collectionIds.has('human-mark') && collectionIds.has('eu-ai-act')) break;
    await Bun.sleep(250);
  }
  check(collectionIds.has('human-mark') && collectionIds.has('eu-ai-act'), 'The packaged starter collections were not installed.');
  const workerResponse = await request('/api/v1/documents/python', { headers });
  check(workerResponse.status === 200 && z.object({ workerAvailable: z.literal(true) }).safeParse(await workerResponse.json()).success, 'The packaged document reader is unavailable without host Python.');
  const hostile = await request('/bootstrap', { method: 'POST', headers: { origin: 'https://untrusted.example', referer: 'air-office://localhost/' } });
  check(hostile.status === 403 && !hostile.headers.has('access-control-allow-origin'), 'An untrusted origin was allowed to bootstrap the service.');
  console.info(JSON.stringify({ result: 'pass', service: executable, checks: ['owned-health', 'windows-bootstrap', 'authenticated-seed-methods', 'authenticated-seed-collections', 'packaged-reader-without-host-python', 'untrusted-origin-denied'] }));
} finally {
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') {
      const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise<void>((resolveKilled) => { killer.once('close', () => resolveKilled()); killer.once('error', () => { child.kill(); resolveKilled(); }); });
    } else child.kill('SIGTERM');
  }
  await Promise.race([closed, Bun.sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  await closed;
  if (!dataRoot.startsWith(temporaryRoot + sep)) throw new Error('Refusing cleanup outside the verification workspace.');
  rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
