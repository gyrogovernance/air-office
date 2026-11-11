import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArchiveToFreshDirectory } from './artifact-archive.adapter';
import { prepareBundledTextBackend } from './bundled-backend.adapter';
import { prepareCodeServerResource } from './prepare-code-server.adapter';
import { prepareWorkbenchExtensions } from './prepare-workbench-extensions.adapter';
import { prepareWebSearchWorker } from '../../../tools/prepare-web-search.entry';
import { prepareDocumentsRuntime } from '../../../tools/prepare-documents.entry';
import packageManifest from '../../../package.json';

interface LemonadeAsset {
  name: string;
  size: number;
  digest: string;
  url: string;
  format: 'zip' | 'tar.gz';
  /** Upstream LICENSE pin for the verified archive root. */
  licenseBytes: number;
  licenseDigest: string;
}
const lemonadeAssets: Readonly<Record<string, LemonadeAsset>> = {
  'x86_64-pc-windows-msvc': { name: 'lemonade-embeddable-2026.42.1-windows-x64.zip', size: 5407306, digest: '6bc9b9f301aa8235f2e6a2a51d75f0ba0f9cb3580e65ff0ea4fc6752ef3a8f3f', url: 'https://github.com/lemonade-sdk/lemonade/releases/download/v2026.42.1/lemonade-embeddable-2026.42.1-windows-x64.zip', format: 'zip', licenseBytes: 19782, licenseDigest: '81d41bd41eebf93d1d0e3dd8104a022cdbe520bbeceaee8ea30307b228ba46a6' },
  'x86_64-unknown-linux-gnu': { name: 'lemonade-embeddable-2026.42.1-ubuntu-x64.tar.gz', size: 7461030, digest: '4aad527c51bb734e807043b999488e0551459deddb84876fe099dd3632453ba1', url: 'https://github.com/lemonade-sdk/lemonade/releases/download/v2026.42.1/lemonade-embeddable-2026.42.1-ubuntu-x64.tar.gz', format: 'tar.gz', licenseBytes: 19782, licenseDigest: '81d41bd41eebf93d1d0e3dd8104a022cdbe520bbeceaee8ea30307b228ba46a6' },
  'aarch64-unknown-linux-gnu': { name: 'lemonade-embeddable-2026.42.1-ubuntu-arm64.tar.gz', size: 6863745, digest: 'beac5f12d6cbdad1e2f34e376930223097c37e1410209fa846f1fbfc306b0e99', url: 'https://github.com/lemonade-sdk/lemonade/releases/download/v2026.42.1/lemonade-embeddable-2026.42.1-ubuntu-arm64.tar.gz', format: 'tar.gz', licenseBytes: 19782, licenseDigest: '81d41bd41eebf93d1d0e3dd8104a022cdbe520bbeceaee8ea30307b228ba46a6' },
  'aarch64-apple-darwin': { name: 'lemonade-embeddable-2026.42.1-macos-arm64.tar.gz', size: 5757127, digest: '07f13e6e1104ef56e77d689c6d31058cb6a6a0a48ba1d2fa40591ab038a42255', url: 'https://github.com/lemonade-sdk/lemonade/releases/download/v2026.42.1/lemonade-embeddable-2026.42.1-macos-arm64.tar.gz', format: 'tar.gz', licenseBytes: 19411, licenseDigest: '83f746cbc5a64bc4f93a0f20304d1a50403bdd6e7f5e7bf739854caf6d3018a4' },
  // Built and provenance-checked on Intel Mac (see external/lemonade/INTEL-MAC-NOTES.txt). Not published upstream.
  'x86_64-apple-darwin': { name: 'lemonade-embeddable-2026.42.1-macos-x64.tar.gz', size: 7226802, digest: '8e7c01591ba1525783d3b325be2994b57ecafa793991c125b418d97d06f4b025', url: 'air-local:external/lemonade/lemonade-embeddable-2026.42.1-macos-x64.tar.gz', format: 'tar.gz', licenseBytes: 19411, licenseDigest: '83f746cbc5a64bc4f93a0f20304d1a50403bdd6e7f5e7bf739854caf6d3018a4' }
};
export function resolveLemonadeAsset(targetTriple: string): LemonadeAsset {
  const asset = lemonadeAssets[targetTriple];
  if (!asset) throw new Error(`Lemonade v2026.42.1 has no portable artifact for target ${targetTriple}.`);
  return asset;
}

/**
 * Upstream archives may contain one versioned top-level directory. Normalize
 * that packaging detail here so the desktop host always receives the same
 * `resources/lemonade` layout.
 */
export function resolveLemonadeArchiveRoot(extractedPath: string, targetTriple: string): string {
  const executableName = targetTriple.includes('windows') ? 'lemond.exe' : 'lemond';
  const cliName = 'lemonade' + (targetTriple.includes('windows') ? '.exe' : '');
  const candidates = [
    extractedPath,
    ...readdirSync(extractedPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(extractedPath, entry.name))
  ].filter((candidate) => existsSync(join(candidate, executableName)) && existsSync(join(candidate, cliName)) && existsSync(join(candidate, 'LICENSE')));
  if (candidates.length !== 1) throw new Error(`The verified Lemonade archive has no unambiguous server root: ${targetTriple}.`);
  return candidates[0]!;
}

export async function prepareLemonadeResource(
  targetTriple: string,
  resourcesRoot: string,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
  extractImpl: typeof extractArchiveToFreshDirectory = extractArchiveToFreshDirectory
): Promise<void> {
  const asset = resolveLemonadeAsset(targetTriple);
  const tempRoot = join(resourcesRoot, '.lemonade-download');
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  try {
    const localArchive = join(repoRoot, 'external', 'lemonade', asset.name);
    let bytes: Buffer;
    if (existsSync(localArchive)) {
      bytes = readFileSync(localArchive);
    } else if (asset.url.startsWith('air-local:')) {
      throw new Error(`Pinned Lemonade archive missing at ${localArchive}. Place the reviewed Intel embeddable there before packaging.`);
    } else {
      const response = await fetchImpl(asset.url);
      if (!response.ok) throw new Error(`Lemonade artifact download failed with HTTP ${response.status}.`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.byteLength !== asset.size) throw new Error(`Lemonade artifact size mismatch: expected ${asset.size}, received ${bytes.byteLength}.`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.digest) throw new Error(`Lemonade artifact SHA-256 mismatch for ${asset.name}.`);

    const archivePath = join(tempRoot, asset.name);
    writeFileSync(archivePath, bytes, { flag: 'wx' });
    const extractedPath = join(tempRoot, 'extracted');
    await extractImpl(archivePath, extractedPath, asset.format, { maxEntries: 20000, maxBytes: 512 * 1024 ** 2, maxFileBytes: 256 * 1024 ** 2 });
    const archiveRoot = resolveLemonadeArchiveRoot(extractedPath, targetTriple);
    const bundledLicense = join(archiveRoot, 'LICENSE');
    if (!existsSync(bundledLicense)) throw new Error(`The verified Lemonade archive is missing its upstream LICENSE: ${asset.name}.`);
    const license = readFileSync(bundledLicense);
    if (license.byteLength !== asset.licenseBytes || createHash('sha256').update(license).digest('hex') !== asset.licenseDigest) {
      throw new Error('Lemonade LICENSE size or SHA-256 verification failed.');
    }
    // The desktop host resolves this exact resource directory at runtime.
    cpSync(archiveRoot, join(resourcesRoot, 'lemonade'), { recursive: true, errorOnExist: true, force: false });
    if (targetTriple.includes('windows')) hideWindowsConsoleHelpers(join(resourcesRoot, 'lemonade'));
    const noticesRoot = join(resourcesRoot, 'notices');
    mkdirSync(noticesRoot, { recursive: true });
    cpSync(bundledLicense, join(noticesRoot, 'lemonade-LICENSE'));
    writeFileSync(join(resourcesRoot, 'lemonade-artifact.sbom.json'), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
      metadata: { component: { type: 'application', name: 'AIR Office desktop runtime resources', version: '0.1.0' }, properties: [{ name: 'air:coverage', value: 'Pinned Lemonade runtime archive only; separately installed backends, weights and desktop dependencies require their own inventories.' }] },
      components: [{ type: 'application', name: 'Lemonade', version: '2026.42.1', 'bom-ref': `lemonade:2026.42.1:${targetTriple}`, licenses: [{ license: { id: 'Apache-2.0' } }], hashes: [{ alg: 'SHA-256', content: digest }], externalReferences: [{ type: 'distribution', url: asset.url }], properties: [{ name: 'air:archive-bytes', value: String(asset.size) }, { name: 'air:target', value: targetTriple }, { name: 'air:source-commit', value: '2aedebc4858642b9dd51e21bdb2791e62b03408b' }] }]
    }, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * IMAGE_SUBSYSTEM_WINDOWS_CUI (3) allocates a console. Packaged Lemonade and its
 * llama.cpp helpers are console PE files; flipping them to WINDOWS_GUI (2) keeps
 * the same Win32 entry point while stopping terminal windows when AIR starts them
 * or when Lemonade starts a backend child.
 */
export function setWindowsGuiSubsystem(executablePath: string): boolean {
  const bytes = Buffer.from(readFileSync(executablePath));
  if (bytes.length < 0x40 || bytes.toString('ascii', 0, 2) !== 'MZ') return false;
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 0x5e > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\u0000\u0000') return false;
  const subsystemOffset = pe + 0x5c;
  if (bytes.readUInt16LE(subsystemOffset) !== 3) return false;
  bytes.writeUInt16LE(2, subsystemOffset);
  writeFileSync(executablePath, bytes);
  return true;
}

export function hideWindowsConsoleHelpers(root: string): number {
  let changed = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.toLowerCase().endsWith('.exe') && setWindowsGuiSubsystem(path)) changed += 1;
    }
  };
  if (existsSync(root)) visit(root);
  return changed;
}


/**
 * Prepares everything the desktop artifact packs: stages the runtime resources
 * (Python worker sources and the sqlite-vec extension), compiles the service
 * into a sidecar binary named for the host target triple, then builds the web
 * frontend. The Electron product build runs this before packaging, so each step
 * fails the whole build when it fails; no step is skipped silently.
 */


const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const resourcesRoot = join(desktopRoot, 'resources');
const binariesRoot = join(desktopRoot, 'binaries');
const targetTriple = process.env.TARGET ?? ({ win32: 'x86_64-pc-windows-msvc', darwin: process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin', linux: process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu' } as Record<string, string>)[process.platform] ?? 'x86_64-pc-windows-msvc';
resolveLemonadeAsset(targetTriple);
const platformTarget = targetTriple.startsWith('aarch64') ? ['arm64', targetTriple.includes('windows') ? 'windows' : targetTriple.includes('darwin') ? 'darwin' : 'linux'] : ['x64', targetTriple.includes('windows') ? 'windows' : targetTriple.includes('darwin') ? 'darwin' : 'linux'];
const [targetArchitecture, targetOs] = platformTarget as [string, string];
const bunTarget = `bun-${targetOs === 'windows' ? 'windows' : targetOs === 'darwin' ? 'darwin' : 'linux'}-${targetArchitecture}`;
const executableSuffix = targetOs === 'windows' ? '.exe' : '';
const sidecarName = `air-office-service-${targetTriple}${executableSuffix}`;
const sqliteVecName = targetOs === 'windows' ? 'vec0.dll' : targetOs === 'darwin' ? 'vec0.dylib' : 'vec0.so';
const sqliteVecSource = join(repoRoot, 'external', 'sqlite-vec', sqliteVecName);

const copies: ReadonlyArray<readonly [string, string]> = [
  [join(repoRoot, 'packages', 'lab-pack', 'data'), join(resourcesRoot, 'lab-pack', 'data')],
  [join(repoRoot, 'workers', 'documents', 'src'), join(resourcesRoot, 'workers', 'documents', 'src')],
  [join(repoRoot, 'external', 'sqlite-vec', sqliteVecName), join(resourcesRoot, 'external', 'sqlite-vec', sqliteVecName)]
];

export function assertSupportedBuildRuntime(version: string): void {
  const minimumBun = packageManifest.engines.bun;
  if (!Bun.semver.satisfies(version, minimumBun)) throw new Error(`Desktop packaging requires Bun ${minimumBun}; found ${version}.`);
}

export type TargetResourceStatus = 'packaged' | 'source-staged' | 'optional-host' | 'host' | 'absent';
export type TargetOperationStatus = 'supported' | 'optional' | 'unsupported';

export interface TargetResourceEntry {
  id: string;
  status: TargetResourceStatus;
  path?: string;
  version?: string;
  notes?: string;
}

export interface TargetOperationEntry {
  id: string;
  status: TargetOperationStatus;
  requires?: string[];
  notes?: string;
}

/** Declares what the selected desktop target actually packs versus what remains host-optional. */
export interface TargetResourceManifest {
  schema_version: 1;
  kind: 'air-office-target-resources';
  target: string;
  doctrine: {
    local_models: 'byok-into-copilot';
    lemonade_chat_stack: 'absent';
  };
  resources: TargetResourceEntry[];
  operations: TargetOperationEntry[];
}

/**
 * Builds the honest target resource declaration written next to staged desktop
 * resources. Lemonade is packaged as a managed local runtime whose OpenAI-
 * compatible endpoint stays BYOK into Copilot. Document worker sources are
 * staged; Docling, OCR weights and pypdfium2 remain optional host installs and
 * are not claimed as fully packaged.
 */
export function buildTargetResourceManifest(target: string, resourcesRoot: string): TargetResourceManifest {
  const lemonadePackaged = existsSync(join(resourcesRoot, 'lemonade'));
  const backendInventoryPath = join(resourcesRoot, 'lemonade-backend.inventory.json');
  const backendInventory = existsSync(backendInventoryPath) ? JSON.parse(readFileSync(backendInventoryPath, 'utf8')) as { bundled?: boolean; version?: string; reason?: string } : null;
  const workerSourceStaged = existsSync(join(resourcesRoot, 'workers', 'documents', 'src', 'office_documents'));
  const documentsRuntimeStaged = existsSync(join(resourcesRoot, 'workers', 'documents-runtime', `air-office-documents${targetTriple.includes('windows') ? '.exe' : ''}`));
  const sqliteVecStaged = existsSync(join(resourcesRoot, 'external', 'sqlite-vec', sqliteVecName));
  const codeServerPackaged = existsSync(join(resourcesRoot, 'code-server', 'bin'));
  const workbenchExtensionsPackaged = existsSync(join(resourcesRoot, 'code-server', 'bundled-extensions'));
  const backendStatus: TargetResourceStatus = backendInventory?.bundled === true ? 'packaged' : 'absent';
  return {
    schema_version: 1,
    kind: 'air-office-target-resources',
    target,
    doctrine: { local_models: 'byok-into-copilot', lemonade_chat_stack: 'absent' },
    resources: [
      { id: 'electron-credentials', status: 'host', path: 'electron-main/safeStorage', notes: 'Electron safeStorage vault via host credentials bridge; no bundled Rust helper.' },
      { id: 'lemonade', status: lemonadePackaged ? 'packaged' : 'absent', path: 'lemonade', version: '2026.42.1', notes: 'Embeddable Lemonade portable archive. Inference remains an OpenAI-compatible BYOK endpoint into Copilot; this resource is not a second chat stack.' },
      { id: 'lemonade-backend-llamacpp-cpu', status: backendStatus, path: backendInventory?.bundled ? 'lemonade/bin' : undefined, version: backendInventory?.version, notes: backendInventory?.bundled ? 'Pinned CPU llamacpp backend staged through Lemonade install.' : (backendInventory?.reason ?? 'Backend not bundled for this target artifact.') },
      { id: 'code-server', status: codeServerPackaged ? 'packaged' : 'absent', path: 'code-server', version: '4.144.0', notes: 'Local VS Code workspace for connected folders. Connection-token password auth; address issued only after AIR authentication.' },
      { id: 'workbench-extensions', status: workbenchExtensionsPackaged ? 'packaged' : 'absent', path: 'code-server/bundled-extensions', notes: 'AIR Office Code shell welcome plus pinned OpenVSX Python, TypeScript language features, and ESLint extensions for connected-folder language tooling.' },
      { id: 'documents-worker-source', status: workerSourceStaged ? 'source-staged' : 'absent', path: 'workers/documents/src', notes: 'Worker source retained with the package; installed execution uses the frozen runtime.' },
      { id: 'documents-worker-runtime', status: documentsRuntimeStaged ? 'packaged' : 'absent', path: 'workers/documents-runtime', notes: 'Self-contained baseline document reader. No host Python discovery or dependency installation at app startup.' },
      { id: 'pypdfium2', status: documentsRuntimeStaged ? 'packaged' : 'absent', version: '5.14.0', notes: 'PDF text-layer engine included in the frozen document reader.' },
      { id: 'docling', status: 'absent', version: '2.137.0', notes: 'Docling is an optional worker extra. Sources are staged, but the engine and its models are not packaged into the target artifact.' },
      { id: 'ocr-models', status: 'absent', notes: 'OCR model weights are not packaged. Image/scanned PDF extraction that needs OCR remains unsupported until a host installs Docling with OCR resources.' },
      { id: 'sqlite-vec', status: sqliteVecStaged ? 'packaged' : 'absent', path: `external/sqlite-vec/${sqliteVecName}`, notes: 'Vector extension for local retrieval.' }
    ],
    operations: [
      { id: 'lemonade-management', status: lemonadePackaged ? 'supported' : 'unsupported', requires: ['lemonade'], notes: 'Lemonade management APIs for backends, models and status.' },
      { id: 'local-openai-compatible-byok', status: lemonadePackaged ? 'supported' : 'unsupported', requires: ['lemonade'], notes: 'Local models stay BYOK into Copilot through the Lemonade OpenAI-compatible endpoint.' },
      { id: 'lemonade-chat-stack', status: 'unsupported', notes: 'No second Lemonade-owned chat path is packaged under Copilot doctrine.' },
      { id: 'connected-folder-workspace', status: codeServerPackaged ? 'supported' : 'unsupported', requires: ['code-server'], notes: 'A connected folder opens as the VS Code workspace in the document stage for this target triple only when code-server is packaged.' },
      { id: 'extract-text-markdown-html', status: documentsRuntimeStaged ? 'supported' : 'unsupported', requires: ['documents-worker-runtime'], notes: 'Frozen baseline reader without Docling.' },
      { id: 'extract-pdf-text-layer', status: documentsRuntimeStaged ? 'supported' : 'unsupported', requires: ['documents-worker-runtime', 'pypdfium2'], notes: 'PDF text-layer extraction needs no host Python installation.' },
      { id: 'extract-pdf-scanned-docx-image', status: 'unsupported', requires: ['docling'], notes: 'Requires a host Docling install; declared absent from the packaged artifact.' },
      { id: 'ocr-extraction', status: 'unsupported', requires: ['docling', 'ocr-models'], notes: 'OCR weights are not packaged; the artifact must not claim OCR readiness.' },
      { id: 'page-and-text-range-anchors', status: workerSourceStaged ? 'supported' : 'unsupported', requires: ['documents-worker-source'], notes: 'Page and UTF-8 text-range anchors resolve against the stored extraction of a preserved source version. Docling bbox/char-span remapping into original page geometry remains open.' }
    ]
  };
}

export function writeTargetResourceManifest(target: string, resourcesRoot: string): string {
  const manifest = buildTargetResourceManifest(target, resourcesRoot);
  const path = join(resourcesRoot, 'target-resources.manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

/** Fail closed when a staged Darwin binary does not match the packaging target. */
export function assertDarwinExecutableArch(path: string, expected: 'x64' | 'arm64'): void {
  if (!existsSync(path)) throw new Error(`Missing desktop binary for arch check: ${path}`);
  const probe = Bun.spawnSync(['file', '-b', path], { stdout: 'pipe', stderr: 'pipe' });
  const detail = new TextDecoder().decode(probe.stdout).trim();
  const token = expected === 'arm64' ? 'arm64' : 'x86_64';
  if (!detail.includes(token)) {
    throw new Error(`Expected ${token} at ${path}, found: ${detail || 'unknown architecture'}`);
  }
}

if (import.meta.main) {
  assertSupportedBuildRuntime(Bun.version);
  console.info(`Preparing desktop resources for ${targetTriple} (bun target ${bunTarget})`);
  rmSync(resourcesRoot, { recursive: true, force: true });
  mkdirSync(resourcesRoot, { recursive: true });
  rmSync(binariesRoot, { recursive: true, force: true });
  mkdirSync(binariesRoot, { recursive: true });
  await prepareLemonadeResource(targetTriple, resourcesRoot);
  await prepareBundledTextBackend(targetTriple, resourcesRoot);
  if (targetTriple.includes('windows')) {
    const silenced = hideWindowsConsoleHelpers(join(resourcesRoot, 'lemonade'));
    console.info(`silenced ${silenced} Windows console helpers under lemonade`);
  }
  const codeServerPrepared = await prepareCodeServerResource(targetTriple, resourcesRoot, join(repoRoot, '.vendor'));
  if (codeServerPrepared) await prepareWorkbenchExtensions(resourcesRoot, join(repoRoot, '.vendor'));
  const hostOs = process.platform === 'win32' ? 'windows' : process.platform;
  // PyInstaller freezes search/documents for the build host only; cross-arch packaging would ship the wrong CPU.
  if (targetOs !== hostOs || targetArchitecture !== process.arch) {
    throw new Error(
      `Native workers (web search, documents) must be built on ${targetOs}/${targetArchitecture}. ` +
      `This host is ${hostOs}/${process.arch}. Run \`bun run build:desktop:mac:arm\` on Apple Silicon, ` +
      `or use the Build macOS Apple Silicon GitHub Actions workflow.`
    );
  }
  cpSync(prepareWebSearchWorker(), join(resourcesRoot, 'workers', 'web-search'), { recursive: true });
  const documentsRuntime = prepareDocumentsRuntime();
  cpSync(documentsRuntime, join(resourcesRoot, 'workers', 'documents-runtime'), { recursive: true });
  const documentsExecutable = join(resourcesRoot, 'workers', 'documents-runtime', `air-office-documents${targetTriple.includes('windows') ? '.exe' : ''}`);
  if (!existsSync(documentsExecutable)) throw new Error(`Documents runtime missing after packaging: ${documentsExecutable}`);
  for (const [from, to] of copies) {
    if (!existsSync(from)) throw new Error(`Missing desktop resource: ${from}`);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  const manifestPath = writeTargetResourceManifest(targetTriple, resourcesRoot);
  console.info(`staged ${copies.length} desktop resources under ${resourcesRoot}`);
  console.info(`wrote target resource manifest ${manifestPath}`);

  const run = (args: string[], label: string): void => {
    // Vite's production bundle OOMs on Node's default ~2GB heap (seen on macos-15-intel CI).
    const nodeOptions = process.env.NODE_OPTIONS ?? '';
    const env = {
      ...process.env,
      NODE_OPTIONS: nodeOptions.includes('max-old-space-size')
        ? nodeOptions
        : [nodeOptions, '--max-old-space-size=8192'].filter(Boolean).join(' '),
    };
    const result = Bun.spawnSync([process.execPath, ...args], { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit', env });
    if (result.exitCode !== 0) throw new Error(`${label} failed with exit code ${result.exitCode}.`);
  };
  run(['run', 'apps/desktop/scripts/sync-desktop-icons.entry.ts'], 'desktop icon sync');
  // Windows: compile as a no-console helper so the installed app never opens a
  // Command Prompt for the service. Lemonade remains an upstream console binary;
  // the desktop host must start it without allocating a console.
  const compileArgs = ['build', '--compile', `--target=${bunTarget}`, '--outfile', join(binariesRoot, sidecarName), join('apps', 'service', 'src', 'application.entry.ts')];
  if (targetTriple.includes('windows')) compileArgs.splice(2, 0, '--windows-hide-console');
  run(compileArgs, 'service sidecar compile');
  // Also stage a plain-named sibling for Electron extraResources.
  const plainSidecar = join(binariesRoot, `air-office-service${executableSuffix}`);
  if (existsSync(join(binariesRoot, sidecarName)) && sidecarName !== `air-office-service${executableSuffix}`) {
    cpSync(join(binariesRoot, sidecarName), plainSidecar);
  }
  if (targetOs === 'darwin') {
    const expected = targetArchitecture === 'arm64' ? 'arm64' : 'x64';
    assertDarwinExecutableArch(join(resourcesRoot, 'lemonade', 'lemonade'), expected);
    assertDarwinExecutableArch(join(binariesRoot, sidecarName), expected);
    assertDarwinExecutableArch(plainSidecar, expected);
  }
  writeTargetResourceManifest(targetTriple, resourcesRoot);
  run(['run', '--cwd', join('apps', 'web'), 'build'], 'web build');
  console.info('desktop artifact inputs prepared');
}

