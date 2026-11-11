import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { stopService } from '../../support/service-launch.adapter';

let processHandle: Subprocess;
let token: string;
let base: string;
let stdoutPromise: Promise<string> = Promise.resolve('');
const secret = `sk-broker-probe-${Date.now()}`;
const keychainService = `air-office/provider-test-${Date.now()}`;
const scratch = mkdtempSync(join(tmpdir(), 'air-cred-service-'));
const filesRoot = join(scratch, 'authorized-root');
mkdirSync(filesRoot, { recursive: true });

const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
beforeAll(async () => {
  const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = reservation.port;
  reservation.stop(true);
  const env: Record<string, string | undefined> = {
    OFFICE_PORT: String(port),
    OFFICE_RUNTIME_DIR: join(scratch, 'runtime'),
    OFFICE_CHAT_DATABASE_PATH: join(scratch, 'chat.sqlite'),
    OFFICE_DOCUMENTS_DATABASE_PATH: join(scratch, 'documents.sqlite'),
    OFFICE_KNOWLEDGE_DATABASE_PATH: join(scratch, 'knowledge.sqlite'),
    OFFICE_JOBS_DATABASE_PATH: join(scratch, 'jobs.sqlite'),
    OFFICE_FILES_ROOT: filesRoot,
    OFFICE_OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
    OFFICE_KEYCHAIN_SERVICE: keychainService
  };
  // Presence must be decided by the keychain under test, never by an inherited token.
  env.OFFICE_PROVIDER_OPENAI_TOKEN = undefined;
  env.OFFICE_CREDENTIALS = undefined;
  processHandle = Bun.spawn([process.execPath, 'src/application.entry.ts'], {
    cwd: join(import.meta.dir, '..', '..', '..', 'apps', 'service'),
    env: { ...Bun.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  stdoutPromise = new Response(processHandle.stdout as ReadableStream<Uint8Array>).text();
  void new Response(processHandle.stderr as ReadableStream<Uint8Array>).text();
  base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    const response = await fetch(`${base}/health`).catch(() => null);
    if (response?.ok) { ready = true; break; }
    if (processHandle.exitCode !== null) break;
    await Bun.sleep(50);
  }
  expect(ready).toBe(true);
  const bootstrap = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } });
  token = (await bootstrap.json() as { token: string }).token;
}, 30_000);

afterAll(async () => {
  processHandle?.kill();
  await stdoutPromise.catch(() => '');
  await stopService(processHandle);
  rmSync(scratch, { recursive: true, force: true });
}, 30_000);

test('T-004: the credential broker stores, reports presence, and forgets without exposing the secret', async () => {
  const before = await (await fetch(`${base}/api/v1/providers`, { headers: headers() })).json() as { providers: { id: string; credentialConfigured: boolean }[] };
  expect(before.providers.find((provider) => provider.id === 'openai')?.credentialConfigured).toBe(false);

  const stored = await fetch(`${base}/api/v1/providers/openai/credential`, { method: 'PUT', headers: headers(), body: JSON.stringify({ secret }) });
  expect(stored.status).toBe(200);
  expect(await stored.json()).toEqual({ providerId: 'openai', credentialConfigured: true });

  const after = await fetch(`${base}/api/v1/providers`, { headers: headers() });
  const afterBody = await after.text();
  expect(JSON.parse(afterBody) as { providers: { id: string; credentialConfigured: boolean }[] });
  expect(afterBody).toContain('"credentialConfigured":true');
  expect(afterBody).not.toContain(secret);

  const bundle = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).text();
  expect(bundle).not.toContain(secret);

  const removed = await fetch(`${base}/api/v1/providers/openai/credential`, { method: 'DELETE', headers: headers() });
  expect(removed.status).toBe(200);
  expect(await removed.json()).toEqual({ providerId: 'openai', credentialConfigured: false });

  const final = await (await fetch(`${base}/api/v1/providers`, { headers: headers() })).text();
  expect(final).toContain('"credentialConfigured":false');
  expect(final).not.toContain(secret);
}, 30_000);

test('T-004: the broker rejects unknown providers and missing secrets without echoing input', async () => {
  const unknown = await fetch(`${base}/api/v1/providers/unknown-provider/credential`, { method: 'PUT', headers: headers(), body: JSON.stringify({ secret }) });
  expect(unknown.status).toBe(404);

  const missing = await fetch(`${base}/api/v1/providers/openai/credential`, { method: 'PUT', headers: headers(), body: JSON.stringify({}) });
  expect(missing.status).toBe(400);
  expect(await missing.text()).not.toContain(secret);

  const empty = await fetch(`${base}/api/v1/providers/openai/credential`, { method: 'PUT', headers: headers(), body: JSON.stringify({ secret: '' }) });
  expect(empty.status).toBe(400);
}, 30_000);

test('T-004: service logs never contain the stored secret', async () => {
  processHandle.kill();
  const stdoutText = await stdoutPromise.catch(() => '');
  expect(stdoutText).not.toContain(secret);
  expect(stdoutText).toContain('"component":"providers"');
  expect(stdoutText).toContain('credential-store');
}, 30_000);
