import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBundledTextBackend } from '../../../../apps/desktop/scripts/bundled-backend.adapter';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'air-backend-stage-'));
  mkdirSync(join(root, 'lemonade', 'resources'), { recursive: true });
  mkdirSync(join(root, 'lemonade', 'bin'), { recursive: true });
  writeFileSync(join(root, 'lemonade', 'resources', 'backend_versions.json'), '{}');
  writeFileSync(join(root, 'lemonade', 'bin', 'llama-server.exe'), 'fixture binary');
  writeFileSync(join(root, 'lemonade', 'bin', 'LICENSE'), 'Upstream llama.cpp license fixture');
  writeFileSync(join(root, 'lemonade-artifact.sbom.json'), JSON.stringify({ components: [] }));
  return root;
}

test('records cross-target backend omission without starting a process or fetching', async () => {
  const root = fixture();
  let spawned = false;
  try {
    await prepareBundledTextBackend('aarch64-apple-darwin', root, {
      platform: 'win32', arch: 'x64',
      spawn: (() => { spawned = true; throw new Error('unexpected spawn'); }) as typeof Bun.spawn,
      fetch: (async () => { throw new Error('unexpected fetch'); }) as unknown as typeof fetch
    });
    const inventory = await Bun.file(join(root, 'lemonade-backend.inventory.json')).json();
    expect(inventory).toMatchObject({ target: 'aarch64-apple-darwin', bundled: false });
    expect(spawned).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('uses pinned dry-run response fields and records backend install request', async () => {
  const root = fixture();
  const calls: Array<{ url: string; body?: string }> = [];
  const child = { exitCode: null, exited: Promise.resolve(0), kill() {} };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, body });
    if (url.endsWith('/v1/health')) return Response.json({ status: 'ok' });
    if (url.endsWith('/v1/install/dry-run')) return Response.json({ recipe: 'llamacpp', backend: 'cpu', arch: '', repo: 'ggml-org/llama.cpp', version: 'b11393', filename: 'llama-b11393-bin-win-cpu-x64.zip', url: 'https://example.invalid/archive.zip', supports_split_archive: false, supported: true });
    if (url.endsWith('/v1/install')) return Response.json({ status: 'ok' });
    if (url.includes('api.github.com')) return Response.json({ assets: [{ name: 'llama-b11393-bin-win-cpu-x64.zip', size: 12, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://example.invalid/archive.zip' }] });
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  try {
    await prepareBundledTextBackend('x86_64-pc-windows-msvc', root, {
      platform: 'win32', arch: 'x64', spawn: (() => child) as unknown as typeof Bun.spawn, fetch: fetchImpl
    });
    expect(calls.some((call) => call.url.endsWith('/v1/install/dry-run') && call.body?.includes('"recipe":"llamacpp"'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/v1/install') && call.body?.includes('"stream":false'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
