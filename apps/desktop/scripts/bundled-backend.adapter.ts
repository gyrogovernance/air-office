import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BackendStagingDependencies {
  spawn?: typeof Bun.spawn;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  platform?: NodeJS.Platform;
  arch?: string;
}

/** Packaging uses Lemonade's installer so backend selection and extraction remain upstream-owned. */
export async function prepareBundledTextBackend(target: string, resourcesRoot: string, dependencies: BackendStagingDependencies = {}): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const arch = dependencies.arch ?? process.arch;
  const host = platform === 'win32' && arch === 'x64'
    ? 'x86_64-pc-windows-msvc'
    : platform === 'darwin' && arch === 'arm64'
      ? 'aarch64-apple-darwin'
      : platform === 'darwin' && arch === 'x64'
        ? 'x86_64-apple-darwin'
        : platform === 'linux'
          ? `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`
          : null;
  if (target !== host) {
    writeFileSync(join(resourcesRoot, 'lemonade-backend.inventory.json'), JSON.stringify({ target, bundled: false, reason: 'Cross-target backend installation requires execution on the target host. Install a supported backend from Local AI before offline use.' }, null, 2));
    return;
  }
  const root = join(resourcesRoot, 'lemonade');
  const key = randomBytes(32).toString('hex');
  const reservation = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const port = reservation.port;
  reservation.stop(true);
  // Windows/Linux pin the CPU recipe. macOS Lemonade only exposes `metal`; on Intel that
  // still downloads ggml-org's macos-x64 CPU archive (see external/lemonade/INTEL-MAC-NOTES.txt).
  const backend = platform === 'darwin' ? 'metal' : 'cpu';
  writeFileSync(join(root, 'config.json'), JSON.stringify({ host: '127.0.0.1', broadcast: false, log_level: 'none', auto_check_model_updates: false, inhibit_suspend: false, telemetry: { enabled: false }, ctx_size: 16384, llamacpp: { backend, prefer_system: false } }));
  const env = { ...process.env, LEMONADE_API_KEY: key, LEMONADE_DISABLE_BROADCAST: '1' };
  for (const name of Object.keys(env)) if (name !== 'LEMONADE_API_KEY' && /TOKEN|API_KEY|SECRET|PASSWORD/iu.test(name)) delete env[name as keyof typeof env];
  const spawn = dependencies.spawn ?? Bun.spawn;
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? Bun.sleep;
  const child = spawn([join(root, platform === 'win32' ? 'lemond.exe' : 'lemond'), './', '--port', String(port)], { cwd: root, env, stdout: 'ignore', stderr: 'ignore' });
  const call = async (path: string, body?: unknown) => {
    const response = await fetchImpl(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: AbortSignal.timeout(body === undefined ? 5000 : 300000), redirect: 'error' });
    if (!response.ok) throw new Error(`Bundled backend operation failed (${response.status}).`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try { await call('/v1/health'); ready = true; break; } catch { await sleep(200); }
    }
    if (!ready) throw new Error('The packaging runtime failed authenticated readiness.');
    const resolved = await call('/v1/install/dry-run', { recipe: 'llamacpp', backend });
    if (resolved.recipe !== 'llamacpp' || resolved.backend !== backend || resolved.repo !== 'ggml-org/llama.cpp' || resolved.version !== 'b11393' || resolved.supported !== true || typeof resolved.filename !== 'string' || !/^[\w.-]+\.zip$|^[\w.-]+\.tar\.gz$/u.test(resolved.filename)) throw new Error('The pinned text backend resolution differs from the expected release.');
    if (platform === 'darwin' && arch === 'x64' && resolved.filename !== 'llama-b11393-bin-macos-x64.tar.gz') throw new Error('Intel Mac packaging requires the pinned macos-x64 llama.cpp archive.');
    // Actions runners share a low unauthenticated GitHub API quota; use the job
    // token when present so packaging can read pinned release digests reliably.
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const releaseResponse = await fetchImpl(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${resolved.version}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!releaseResponse.ok) throw new Error(`Backend release integrity metadata is unavailable (HTTP ${releaseResponse.status}).`);
    const release = await releaseResponse.json() as { assets?: Array<{ name: string; size: number; digest: string; browser_download_url: string }> };
    const asset = release.assets?.find((item) => item.name === resolved.filename);
    if (!asset || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest) || asset.size <= 0 || asset.size > 100 * 1024 ** 2) throw new Error('Backend archive has no bounded authoritative SHA-256.');
    const versionsPath = join(root, 'resources', 'backend_versions.json');
    const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
    versions.checksums ??= {}; versions.checksums.github ??= {}; versions.checksums.github[resolved.repo] ??= {}; versions.checksums.github[resolved.repo][resolved.version] ??= {};
    versions.checksums.github[resolved.repo][resolved.version][resolved.filename] = asset.digest;
    writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
    await call('/v1/install', { recipe: 'llamacpp', backend, stream: false });
    const files: Array<{ path: string; bytes: number; sha256: string }> = [];
    function inventory(directory: string, relative = 'bin') {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) inventory(join(directory, entry.name), path);
        else if (entry.isFile() || entry.isSymbolicLink()) {
          const bytes = readFileSync(join(directory, entry.name));
          files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        } else throw new Error('Unsupported backend filesystem entry.');
      }
    }
    inventory(join(root, 'bin'));
    if (!files.some((file) => /llama-server(?:\.exe)?$/u.test(file.path))) throw new Error('Bundled text backend is missing its server.');
    let licenseFile = files.find((file) => /(?:^|\/)(?:LICENSE|LICENSE\.txt|COPYING)(?:\.txt)?$/iu.test(file.path));
    if (!licenseFile) {
      const licenseResponse = await fetchImpl('https://raw.githubusercontent.com/ggml-org/llama.cpp/b11393/LICENSE', { signal: AbortSignal.timeout(30000) });
      if (!licenseResponse.ok) throw new Error('The pinned backend license is unavailable.');
      const bytes = Buffer.from(await licenseResponse.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d') throw new Error('The pinned backend license SHA-256 differs.');
      writeFileSync(join(root, 'bin', 'LICENSE'), bytes);
      licenseFile = { path: 'bin/LICENSE', bytes: bytes.length, sha256 };
      files.push(licenseFile);
    }
    const licensePath = join(root, licenseFile.path);
    const licenseHash = createHash('sha256').update(readFileSync(licensePath)).digest('hex');
    mkdirSync(join(resourcesRoot, 'notices'), { recursive: true });
    copyFileSync(licensePath, join(resourcesRoot, 'notices', 'llama.cpp-LICENSE'));
    writeFileSync(join(resourcesRoot, 'lemonade-backend.inventory.json'), JSON.stringify({ target, bundled: true, recipe: 'llamacpp', backend: 'cpu', version: resolved.version, archive: asset, files, license: { path: 'notices/llama.cpp-LICENSE', source: licenseFile.path, sha256: licenseHash }, weightsBundled: false }, null, 2));
    const sbomPath = join(resourcesRoot, 'lemonade-artifact.sbom.json');
    const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
    sbom.components.push({ type: 'application', name: 'llama.cpp', version: resolved.version, 'bom-ref': `llamacpp:${resolved.version}:${target}`, licenses: [{ license: { id: 'MIT' } }], hashes: [{ alg: 'SHA-256', content: licenseHash }], externalReferences: [{ type: 'distribution', url: asset.browser_download_url }], properties: [{ name: 'air:archive-sha256', value: asset.digest.slice(7) }, { name: 'air:archive-bytes', value: String(asset.size) }, { name: 'air:license-file', value: 'notices/llama.cpp-LICENSE' }, ...files.map((file) => ({ name: `air:file:${file.path}`, value: `${file.bytes}:${file.sha256}` }))] });
    writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
  } finally {
    child.kill();
    await child.exited;
  }
}
