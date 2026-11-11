import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSupportedBuildRuntime, buildTargetResourceManifest, resolveLemonadeArchiveRoot, resolveLemonadeAsset, prepareLemonadeResource, writeTargetResourceManifest } from '../../../../apps/desktop/scripts/prepare-desktop-artifact.entry';
const script = readFileSync(join(import.meta.dir, '..', '..', '..', '..', 'apps', 'desktop', 'scripts', 'prepare-desktop-artifact.entry.ts'), 'utf8');

test('packaging refuses vulnerable Bun compilers and accepts the security release', () => {
  for (const version of ['1.2.0', '1.4.0', '1.4.3']) expect(() => assertSupportedBuildRuntime(version)).toThrow('Desktop packaging requires Bun');
  expect(() => assertSupportedBuildRuntime('1.4.4')).not.toThrow();
  expect(() => assertSupportedBuildRuntime('1.4.5')).not.toThrow();
});

test('desktop artifact inputs select target-specific sidecars and build-only archive extraction', () => {
  expect(script).toContain('process.env.TARGET'); expect(script).not.toContain('model-advisor');
  expect(script).not.toContain('TAURI_ENV_TARGET_TRIPLE');
  expect(script).toContain("from './artifact-archive.adapter'"); expect(script).toContain('bun-${targetOs');
  expect(script).toContain('air-office-service-${targetTriple}${executableSuffix}');
  expect(script).toContain('assertDarwinExecutableArch');
  expect(script).toContain('Native workers (web search, documents) must be built on');
  for (const name of ['vec0.dll', 'vec0.dylib', 'vec0.so']) expect(script).toContain(name);
});

test('resolves only pinned portable targets and rejects unsupported targets', () => {
  expect(resolveLemonadeAsset('x86_64-pc-windows-msvc').name).toContain('windows-x64.zip');
  expect(resolveLemonadeAsset('x86_64-unknown-linux-gnu').name).toContain('ubuntu-x64.tar.gz');
  expect(resolveLemonadeAsset('aarch64-unknown-linux-gnu').name).toContain('ubuntu-arm64.tar.gz');
  expect(resolveLemonadeAsset('aarch64-apple-darwin').name).toContain('macos-arm64.tar.gz');
  expect(resolveLemonadeAsset('x86_64-apple-darwin').name).toContain('macos-x64.tar.gz');
  for (const target of ['aarch64-pc-windows-msvc', 'i686-unknown-linux-gnu']) expect(() => resolveLemonadeAsset(target)).toThrow('no portable artifact');
});

test('normalizes a versioned archive root and rejects ambiguous layouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'air-lemonade-layout-'));
  try {
    const versioned = join(root, 'lemonade-embeddable-2026.42.1-windows-x64'); mkdirSync(versioned, { recursive: true });
    for (const name of ['lemond.exe', 'lemonade.exe', 'LICENSE']) writeFileSync(join(versioned, name), 'fixture');
    expect(resolveLemonadeArchiveRoot(root, 'x86_64-pc-windows-msvc')).toBe(versioned);
    const second = join(root, 'second'); mkdirSync(second, { recursive: true });
    for (const name of ['lemond.exe', 'lemonade.exe', 'LICENSE']) writeFileSync(join(second, name), 'fixture');
    expect(() => resolveLemonadeArchiveRoot(root, 'x86_64-pc-windows-msvc')).toThrow('no unambiguous server root');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects incorrect downloaded size before attempting extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'air-lemonade-')); let extracted = false;
  try {
    await expect(prepareLemonadeResource('x86_64-pc-windows-msvc', root, async () => new Response(new Uint8Array([1, 2, 3])), async () => { extracted = true; })).rejects.toThrow('size mismatch');
    expect(extracted).toBe(false); expect(existsSync(join(root, 'lemonade'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects digest mismatch before extraction', async () => {
  const asset = resolveLemonadeAsset('x86_64-pc-windows-msvc'); const root = await mkdtemp(join(tmpdir(), 'air-lemonade-')); let extracted = false;
  try {
    await expect(prepareLemonadeResource('x86_64-pc-windows-msvc', root, async () => new Response(new Uint8Array(asset.size)), async () => { extracted = true; })).rejects.toThrow('SHA-256 mismatch');
    expect(extracted).toBe(false); expect(existsSync(join(root, 'lemonade'))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('target resource manifest declares Lemonade packaging and absent Docling/OCR honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'air-target-resources-'));
  try {
    mkdirSync(join(root, 'lemonade'), { recursive: true });
    mkdirSync(join(root, 'workers', 'documents', 'src', 'office_documents'), { recursive: true });
    writeFileSync(join(root, 'lemonade-backend.inventory.json'), JSON.stringify({ target: 'x86_64-pc-windows-msvc', bundled: false, reason: 'fixture' }));
    const path = writeTargetResourceManifest('x86_64-pc-windows-msvc', root);
    expect(path).toBe(join(root, 'target-resources.manifest.json'));
    const manifest = buildTargetResourceManifest('x86_64-pc-windows-msvc', root);
    expect(manifest.doctrine).toEqual({ local_models: 'byok-into-copilot', lemonade_chat_stack: 'absent' });
    expect(manifest.resources.find((entry) => entry.id === 'lemonade')?.status).toBe('packaged');
    expect(manifest.resources.find((entry) => entry.id === 'docling')?.status).toBe('absent');
    expect(manifest.resources.find((entry) => entry.id === 'ocr-models')?.status).toBe('absent');
      expect(manifest.resources.find((entry) => entry.id === 'pypdfium2')?.status).toBe('absent');
    expect(manifest.operations.find((entry) => entry.id === 'lemonade-chat-stack')?.status).toBe('unsupported');
    expect(manifest.operations.find((entry) => entry.id === 'ocr-extraction')?.status).toBe('unsupported');
    expect(manifest.operations.find((entry) => entry.id === 'local-openai-compatible-byok')?.status).toBe('supported');
    expect(JSON.parse(readFileSync(path, 'utf8')).kind).toBe('air-office-target-resources');
    expect(script).toContain('writeTargetResourceManifest');
  } finally { await rm(root, { recursive: true, force: true }); }
});
