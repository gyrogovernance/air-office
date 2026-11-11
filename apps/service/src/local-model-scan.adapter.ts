import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { open, readdir, readFile, realpath, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, dirname, basename, isAbsolute, sep, delimiter } from 'node:path';

export type ModelLocation = { id: string; name: string; path: string; extra: boolean };
export type DetectedModel = { id: string; name: string; path: string; format: 'GGUF' | 'MLX'; role: 'chat' | 'embedding' | 'rerank' | 'image'; size: number; locationId: string; importedModel?: string; importedCanonical?: string; issue?: string };
export type DetectedEngine = { id: string; name: string; kind: 'llama.cpp' | 'ollama' | 'lm-studio' | 'vllm' | 'other'; version: string | null; path: string; running: boolean; port: number | null; installed?: boolean; builds?: string[] };
type ScanState = { folders: ModelLocation[]; models: DetectedModel[]; engines: DetectedEngine[]; scannedAt: string | null; warnings: string[]; hiddenBuilds: string[]; deletedModels: string[] };
const identity = (path: string) => createHash('sha256').update(path).digest('hex');
/**
 * What a model file can do, read from its name and the folders it sits in.
 * The folder often carries the family, because many model files are called
 * nothing but "model.gguf".
 */
const modelRole = (name: string, path = ''): DetectedModel['role'] => {
  const text = `${name} ${path}`;
  if (/rerank/i.test(text)) return 'rerank';
  if (/embed|bge-(?:small|base|large)|e5-/i.test(text)) return 'embedding';
  if (/qwen[-_. ]?image|flux[-_.]?dev|flux[-_.]?schnell|z[-_. ]?image|stable[-_. ]?diffusion|sdxl|sd[-_. ]?turbo|esrgan|realesrgan/i.test(text)) return 'image';
  return 'chat';
};
/** The recipe that serves a model of a given role. */
export const roleRecipe: Record<DetectedModel['role'], string> = { chat: 'llamacpp', embedding: 'llamacpp', rerank: 'llamacpp', image: 'sd-cpp' };
/** The labels the runtime uses for a model of a given role. */
export const roleLabels: Record<DetectedModel['role'], string[]> = { chat: ['chat'], embedding: ['embeddings'], rerank: ['reranking'], image: ['image'] };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function defaultModelLocations(home = homedir(), environment: NodeJS.ProcessEnv = process.env, platform = process.platform, modelsDirectory?: string | null): ModelLocation[] {
  const cache = environment.XDG_CACHE_HOME || join(home, '.cache');
  const app = platform === 'win32' ? environment.APPDATA || join(home, 'AppData', 'Roaming') : platform === 'darwin' ? join(home, 'Library', 'Application Support') : environment.XDG_DATA_HOME || join(home, '.local', 'share');
  const local = environment.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const candidates: [string, string][] = [];
  // The Data → Models folder is the owned download and import root; scan it
  // without asking the user to add it again after every restart.
  if (modelsDirectory && isAbsolute(modelsDirectory) && dirname(modelsDirectory) !== modelsDirectory) candidates.push(['AI models', modelsDirectory]);
  candidates.push(
    ['Ollama', environment.OLLAMA_MODELS || join(home, '.ollama', 'models')],
    ['LM Studio', environment.LM_STUDIO_MODELS_DIR || join(home, '.lmstudio', 'models')], ['LM Studio (legacy)', join(cache, 'lm-studio', 'models')],
    ['Hugging Face / Unsloth', environment.HF_HUB_CACHE || environment.HUGGINGFACE_HUB_CACHE || join(environment.HF_HOME || join(cache, 'huggingface'), 'hub')],
    ['Unsloth', join(home, '.unsloth', 'models')],
    ['GPT4All', join(platform === 'win32' ? local : app, 'nomic.ai', 'GPT4All')],
    ['Jan', join(app, 'Jan', 'data', 'llamacpp', 'models')], ['Jan MLX', join(app, 'Jan', 'data', 'mlx', 'models')], ['Jan (legacy)', join(home, 'jan', 'models')],
    ['Msty', join(app, 'Msty', 'models')], ['Msty Studio', join(app, 'MstyStudio', 'models')], ['Msty (legacy)', join(home, '.msty', 'models')],
    ['llama.cpp', environment.LLAMA_CACHE || (platform === 'darwin' ? join(home, 'Library', 'Caches', 'llama.cpp') : platform === 'win32' ? join(local, 'llama.cpp') : join(cache, 'llama.cpp'))],
  );
  if (platform === 'linux') candidates.push(['Ollama service', '/usr/share/ollama/.ollama/models']);
  return [...new Map(candidates.map(([name, path]) => [path, { id: identity(path), name, path, extra: false }])).values()];
}
export async function hasGgufHeader(path: string): Promise<boolean> {
  const file = await open(path, 'r');
  try { const bytes = Buffer.alloc(8); const { bytesRead } = await file.read(bytes, 0, 8, 0); return bytesRead === 8 && bytes.toString('ascii', 0, 4) === 'GGUF' && [1, 2, 3].includes(bytes.readUInt32LE(4)); }
  finally { await file.close(); }
}

/** Local inference servers a user already runs, found by their well-known port. */
export const engineEndpoints: { id: string; name: string; kind: DetectedEngine['kind']; port: number; path: string }[] = [
  { id: 'ollama', name: 'Ollama', kind: 'ollama', port: 11434, path: '/api/tags' },
  { id: 'llama.cpp', name: 'llama.cpp server', kind: 'llama.cpp', port: 8080, path: '/health' },
  { id: 'lm-studio', name: 'LM Studio', kind: 'lm-studio', port: 1234, path: '/v1/models' },
  { id: 'vllm', name: 'vLLM', kind: 'vllm', port: 8000, path: '/v1/models' },
];

/**
 * Engines the user has installed on this computer. A running server is only one
 * way to use an engine, so the installation itself is looked up on disk.
 */
export const engineInstallations: { id: string; name: string; kind: DetectedEngine['kind']; executables: string[]; directories: (environment: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform) => string[] }[] = [
  {
    id: 'ollama', name: 'Ollama', kind: 'ollama', executables: ['ollama.exe', 'ollama'],
    directories: (environment, home, platform) => {
      const local = environment.LOCALAPPDATA || join(home, 'AppData', 'Local');
      const program = environment.ProgramFiles || 'C:\\Program Files';
      return platform === 'win32' ? [join(local, 'Programs', 'Ollama'), join(program, 'Ollama'), join(home, '.ollama', 'bin')] : ['/usr/local/bin', '/usr/bin', join(home, '.local', 'bin')];
    }
  },
  {
    id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp', executables: ['llama-server.exe', 'llama-server', 'llama-cli.exe', 'llama-cli', 'server.exe'],
    directories: (environment, home, platform) => {
      const local = environment.LOCALAPPDATA || join(home, 'AppData', 'Local');
      return platform === 'win32'
        ? [join(local, 'llama.cpp'), join(local, 'Programs', 'llama.cpp'), join(local, 'llama.cpp', 'build', 'bin'), join(home, '.lmstudio', 'bin')]
        : ['/usr/local/bin', '/usr/bin', join(home, '.local', 'bin')];
    }
  },
  {
    id: 'lm-studio', name: 'LM Studio', kind: 'lm-studio', executables: ['LM Studio.exe', 'lms', 'LM Studio', 'lms.exe'],
    directories: (environment, home, platform) => {
      const local = environment.LOCALAPPDATA || join(home, 'AppData', 'Local');
      return platform === 'win32' ? [join(local, 'Programs', 'LM Studio'), join(local, 'LM-Studio'), join(home, '.lmstudio', 'bin')] : ['/usr/local/bin', join(home, 'Applications', 'LM Studio.app', 'Contents', 'MacOS')];
    }
  },
  {
    id: 'vllm', name: 'vLLM', kind: 'vllm', executables: ['vllm.exe', 'vllm'],
    directories: (environment, home) => [join(home, 'AppData', 'Roaming', 'Python'), join(home, '.local', 'bin'), '/usr/local/bin', '/usr/bin']
  },
];

const pathDirectories = (environment: NodeJS.ProcessEnv): string[] => (environment.PATH || environment.Path || '').split(delimiter).filter(Boolean);

/** Engine executables that mark a folder as holding an engine installation. */
const engineExecutables = new Map<string, { id: string; name: string; kind: DetectedEngine['kind'] }>([
  ['ollama.exe', { id: 'ollama', name: 'Ollama', kind: 'ollama' }], ['ollama', { id: 'ollama', name: 'Ollama', kind: 'ollama' }],
  ['llama-server.exe', { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp' }], ['llama-server', { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp' }],
  ['llama-cli.exe', { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp' }], ['llama-cli', { id: 'llama.cpp', name: 'llama.cpp', kind: 'llama.cpp' }],
  ['lms.exe', { id: 'lm-studio', name: 'LM Studio', kind: 'lm-studio' }], ['lms', { id: 'lm-studio', name: 'LM Studio', kind: 'lm-studio' }],
  ['LM Studio.exe', { id: 'lm-studio', name: 'LM Studio', kind: 'lm-studio' }],
  ['vllm.exe', { id: 'vllm', name: 'vLLM', kind: 'vllm' }], ['vllm', { id: 'vllm', name: 'vLLM', kind: 'vllm' }],
]);

/** A server binary describes an engine better than a command line binary. */
const enginePriority = (file: string) => /server/i.test(file) ? 2 : /cli/i.test(file) ? 1 : 0;

/**
 * The version a build reports when it is asked. Two builds of the same engine
 * are told apart by their version, because the path alone says nothing about
 * which one is newer.
 */
export function buildVersion(path: string, timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => { if (!settled) { settled = true; resolve(value); } };
    try {
      const child = execFile(path, ['--version'], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (error && !stdout && !stderr) return finish(null);
        const text = `${stdout} ${stderr}`;
        const match = /version\s+([0-9][0-9A-Za-z.\-+]*)/i.exec(text) ?? /([0-9]+\.[0-9]+(?:\.[0-9]+)?)/.exec(text);
        finish(match?.[1] ?? (text.trim() ? text.trim().split('\n')[0]!.slice(0, 80) : null));
      });
      child.on('error', () => finish(null));
    } catch { finish(null); }
  });
}

/**
 * Engines found inside the folders the user asked to scan. An engine
 * installation is a directory of executables, so the folder is walked for the
 * executables that identify one.
 */
export async function detectEnginesInFolders(folders: ModelLocation[], signal?: AbortSignal): Promise<DetectedEngine[]> {
  const found = new Map<string, DetectedEngine>();
  let entries = 0;
  const deadline = Date.now() + 15_000;
  async function walk(path: string, depth: number) {
    signal?.throwIfAborted();
    if (depth > 6 || entries > 40_000 || Date.now() > deadline) return;
    let children;
    try { children = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of children) {
      signal?.throwIfAborted();
      if (entries > 40_000 || Date.now() > deadline) return;
      entries++;
      if (!entry.isDirectory()) continue;
      const folder = join(path, entry.name);
      let files: string[];
      try { files = await readdir(folder); } catch { continue; }
      for (const file of files) {
        const engine = engineExecutables.get(file.toLowerCase());
        if (!engine) continue;
        const id = `folder:${engine.id}:${folder}`;
        const known = found.get(id);
        if (!known || enginePriority(file) > enginePriority(basename(known.path))) found.set(id, { id, name: engine.name, kind: engine.kind, version: null, path: join(folder, file), running: false, port: null, installed: true });
      }
      await walk(folder, depth + 1);
    }
  }
  for (const folder of folders) await walk(folder.path, 0);
  // One entry per engine and scanned root, so several builds of the same
  // engine do not fill the list with the same engine. The builds themselves
  // are kept, so a user can pick the one they want to use.
  const perRoot = new Map<string, DetectedEngine>();
  for (const engine of found.values()) {
    const root = folders.find((folder) => engine.path.toLowerCase().startsWith(folder.path.toLowerCase().replaceAll('/', sep)));
    const id = `folder:${engine.kind}:${root?.id ?? engine.kind}`;
    const known = perRoot.get(id);
    if (!known) { perRoot.set(id, { ...engine, id, builds: [engine.path] }); continue; }
    const better = enginePriority(basename(engine.path)) > enginePriority(basename(known.path));
    const builds = [...new Set([...(known.builds ?? []), engine.path])];
    perRoot.set(id, { ...(better ? engine : known), id, builds });
  }
  return [...perRoot.values()];
}

async function findExecutable(candidates: string[], directories: string[]): Promise<string | null> {
  for (const directory of directories) {
    for (const candidate of candidates) {
      const file = join(directory, candidate);
      if (await stat(file).then((info) => info.isFile()).catch(() => false)) return file;
    }
  }
  return null;
}

/** Engines installed on this computer, whether or not they are running. */
export async function detectInstalledEngines(environment: NodeJS.ProcessEnv = process.env, home = homedir(), platform = process.platform): Promise<DetectedEngine[]> {
  const found: DetectedEngine[] = [];
  for (const installation of engineInstallations) {
    const directories = [...new Set([...installation.directories(environment, home, platform), ...pathDirectories(environment)])];
    const file = await findExecutable(installation.executables, directories);
    if (file) found.push({ id: installation.id, name: installation.name, kind: installation.kind, version: null, path: file, running: false, port: null, installed: true });
  }
  return found;
}
const engineVersion = (value: unknown): string | null => {
  if (!object(value)) return null;
  for (const key of ['version', 'server_version', 'build']) if (typeof value[key] === 'string') return value[key] as string;
  const data = value.data;
  if (Array.isArray(data) && data.length && object(data[0]) && typeof data[0].owned_by === 'string') return String(data[0].owned_by);
  return null;
};
export async function detectLocalEngines(signal?: AbortSignal, endpoints = engineEndpoints): Promise<DetectedEngine[]> {
  const found: DetectedEngine[] = [];
  for (const endpoint of endpoints) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}${endpoint.path}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(1_500)]) : AbortSignal.timeout(1_500), headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const version = engineVersion(await response.json().catch(() => null));
      found.push({ id: endpoint.id, name: endpoint.name, kind: endpoint.kind, version, path: `http://127.0.0.1:${endpoint.port}`, running: true, port: endpoint.port });
    } catch { /* A server that is not running is simply not detected. */ }
  }
  return found;
}

/** Running servers and installed engines, in one list. */
export async function detectEngines(signal?: AbortSignal, folders: ModelLocation[] = []): Promise<DetectedEngine[]> {
  const running = await detectLocalEngines(signal);
  const installed = await detectInstalledEngines();
  const inFolders = await detectEnginesInFolders(folders, signal);
  const found: DetectedEngine[] = running.map((engine) => ({ ...engine, installed: installed.some((item) => item.id === engine.id) }));
  for (const engine of installed) if (!running.some((item) => item.id === engine.id)) found.push(engine);
  for (const engine of inFolders) if (!found.some((item) => item.id === engine.id)) found.push(engine);
  return found;
}

/**
 * Engines the managed runtime already has installed. The runtime keeps its own
 * engine catalogue, so it knows about backends that no folder scan can find.
 */
export function enginesFromSystemInfo(value: unknown): DetectedEngine[] {
  if (!object(value) || !object(value.recipes)) return [];
  const found: DetectedEngine[] = [];
  for (const [recipe, entry] of Object.entries(value.recipes)) {
    if (!object(entry) || !object(entry.backends)) continue;
    const label = typeof entry.web_display_name === 'string' ? entry.web_display_name : typeof entry.display_name === 'string' ? entry.display_name : recipe;
    for (const [id, backend] of Object.entries(entry.backends)) {
      if (!object(backend) || typeof backend.state !== 'string' || backend.state !== 'installed') continue;
      // The runtime's llama.cpp engine is the same engine a user may have
      // installed themselves, so it is reported as such.
      const kind: DetectedEngine['kind'] = recipe === 'llamacpp' ? 'llama.cpp' : 'other';
      found.push({ id: `runtime:${recipe}:${id}`, name: label, kind, version: null, path: `Runtime engine · ${recipe}/${id}`, running: false, port: null, installed: true });
    }
  }
  return found;
}
async function json(path: string): Promise<unknown> { const info = await stat(path); if (info.size > 4_000_000) throw new Error('Metadata is too large.'); return JSON.parse(await readFile(path, 'utf8')); }

export async function scanModelLocations(locations: ModelLocation[], signal?: AbortSignal) {
  const models = new Map<string, DetectedModel>(); const visited = new Set<string>(); const warnings: string[] = [];
  const ollamaNames = new Map<string, string>(); const projectors = new Set<string>();
  let entries = 0; const deadline = Date.now() + 30_000;
  const limited = () => entries >= 50_000 || models.size >= 2000 || Date.now() > deadline;
  async function walk(path: string, location: ModelLocation, depth: number) {
    signal?.throwIfAborted();
    if (limited()) return;
    if (depth > 12) { if (!warnings.includes('Some deeply nested folders were skipped.')) warnings.push('Some deeply nested folders were skipped.'); return; }
    let folder: string;
    try { folder = await realpath(path); } catch { return; }
    if (visited.has(folder)) return; visited.add(folder);
    let children;
    try { children = await readdir(folder, { withFileTypes: true }); }
    catch { warnings.push(`${location.name}: a folder could not be read.`); return; }
    const config = children.find((entry) => entry.name === 'config.json');
    const weights = children.filter((entry) => entry.name.endsWith('.safetensors'));
    if (config && weights.length) {
      const value = await json(join(folder, config.name)).catch(() => null);
      if (object(value) && (object(value.quantization) || folder.toLowerCase().includes('mlx')) && typeof value.model_type === 'string') {
        let size = 0; for (const entry of weights) size += (await stat(join(folder, entry.name))).size;
        const id = identity(folder); models.set(id, { id, name: basename(dirname(folder)) === 'snapshots' ? basename(dirname(dirname(folder))).replace(/^models--/, '').replaceAll('--', '/') : basename(folder), path: folder, format: 'MLX', role: 'chat', size, locationId: location.id, issue: 'MLX is detected, but the current local runtime does not support it.' });
        return;
      }
    }
    for (const entry of children) {
      signal?.throwIfAborted(); if (limited()) break; entries++;
      const file = join(folder, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink() && await stat(file).then((value) => value.isDirectory()).catch(() => false)) { if (!['node_modules', '.git', '.venv', 'venv'].includes(entry.name)) await walk(file, location, depth + 1); continue; }
      if (folder.includes(`${sep}manifests${sep}`) && entry.isFile()) {
        const manifest = await json(file).catch(() => null);
        if (object(manifest) && Array.isArray(manifest.layers)) for (const layer of manifest.layers) {
          if (!object(layer) || typeof layer.digest !== 'string' || typeof layer.mediaType !== 'string') continue;
          const digest = layer.digest.replace(':', '-');
          if (layer.mediaType === 'application/vnd.ollama.image.model') ollamaNames.set(digest, `${basename(folder)}:${entry.name}`);
          else if (/projector|adapter/.test(layer.mediaType)) projectors.add(digest);
        }
      }
      const candidate = /\.gguf$/i.test(entry.name) || /^sha256[-:][a-f0-9]{64}$/i.test(entry.name);
      const shard = entry.name.match(/-(\d+)-of-(\d+)\.gguf$/i);
      if (!candidate || /mmproj/i.test(entry.name) || shard && Number(shard[1]) > 1) continue;
      try {
        if (!(await hasGgufHeader(file))) continue;
        const canonical = await realpath(file); const info = await stat(canonical); const id = identity(canonical);
        if (models.has(id)) continue;
        let issue: string | undefined;
        const split = entry.name.match(/-0*1-of-(\d+)\.gguf$/i);
        if (split) { const total = Number(split[1]); const prefix = entry.name.replace(/-\d+-of-\d+\.gguf$/i, ''); if (children.filter((part) => part.name.startsWith(prefix + '-') && /-\d+-of-\d+\.gguf$/i.test(part.name)).length !== total) issue = 'Some model shards are missing.'; }
        models.set(id, { id, name: entry.name.replace(/\.gguf$/i, ''), path: canonical, format: 'GGUF', role: modelRole(entry.name, canonical), size: info.size, locationId: location.id, ...(issue ? { issue } : {}) });
      } catch { warnings.push(`${location.name}: a model file could not be read.`); }
    }
  }
  for (const location of locations) await walk(location.path, location, 0);
  if (limited()) warnings.push('Scan limit reached. Add a more specific folder to find remaining models.');
  return { models: [...models.values()].filter((model) => !projectors.has(basename(model.path))).map((model) => { const name = ollamaNames.get(basename(model.path)) ?? model.name; return { ...model, name, role: modelRole(name, model.path) }; }), warnings: [...new Set(warnings)], scannedAt: new Date().toISOString() };
}

export function createLocalModelScanStore(path: string, defaults = defaultModelLocations()) {
  let state: ScanState = { folders: [], models: [], engines: [], scannedAt: null, warnings: [], hiddenBuilds: [], deletedModels: [] }; let loaded = false;
  let enginesCheckedAt = 0; let enginesPending: Promise<void> | null = null;
  async function refreshEngines(signal?: AbortSignal, force = false) {
    if (!force && Date.now() - enginesCheckedAt < 10_000) return;
    if (enginesPending) { await enginesPending; return; }
    enginesPending = (async () => { state.engines = await detectEngines(signal, [...defaults, ...state.folders]); enginesCheckedAt = Date.now(); })().finally(() => { enginesPending = null; });
    await enginesPending;
  }
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  async function save() { const snapshot = JSON.stringify(state); const next = writing.then(async () => { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, snapshot, { mode: 0o600 }); await rename(temporary, path); }); writing = next.catch(() => {}); await next; }
  async function readState() {
    if (loaded) return;
    const value = await json(path).catch((error: unknown) => { if (object(error) && error.code === 'ENOENT') return null; throw error; });
    if (value !== null) {
      if (!object(value) || !Array.isArray(value.folders) || !Array.isArray(value.models) || !Array.isArray(value.warnings)) throw new Error('Model scan settings could not be read.');
      const folders = value.folders.flatMap((item: unknown): ModelLocation[] => object(item) && typeof item.path === 'string' && isAbsolute(item.path) ? [{ id: identity(item.path), path: item.path, name: typeof item.name === 'string' ? item.name : basename(item.path), extra: true }] : []);
      const models = value.models.flatMap((item: unknown): DetectedModel[] => object(item) && typeof item.path === 'string' && isAbsolute(item.path) && typeof item.name === 'string' && typeof item.locationId === 'string' && (item.format === 'GGUF' || item.format === 'MLX') && typeof item.size === 'number' ? [{ id: identity(item.path), path: item.path, name: item.name, locationId: item.locationId, format: item.format, role: modelRole(item.name, item.path), size: item.size, ...(typeof item.issue === 'string' ? { issue: item.issue } : {}), ...(typeof item.importedModel === 'string' ? { importedModel: item.importedModel } : {}), ...(typeof item.importedCanonical === 'string' ? { importedCanonical: item.importedCanonical } : {}) }] : []);
      const engines = Array.isArray(value.engines) ? value.engines.flatMap((item: unknown): DetectedEngine[] => object(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string' ? [{ id: item.id, name: item.name, kind: (typeof item.kind === 'string' ? item.kind : 'other') as DetectedEngine['kind'], version: typeof item.version === 'string' ? item.version : null, path: item.path, running: item.running === true, port: typeof item.port === 'number' ? item.port : null, ...(Array.isArray(item.builds) ? { builds: item.builds.filter((build): build is string => typeof build === 'string') } : {}) }] : []) : [];
      const hiddenBuilds = Array.isArray(value.hiddenBuilds) ? value.hiddenBuilds.filter((item): item is string => typeof item === 'string') : [];
      const deletedModels = Array.isArray(value.deletedModels) ? value.deletedModels.filter((item): item is string => typeof item === 'string') : [];
      state = { folders, models, engines, warnings: value.warnings.filter((item): item is string => typeof item === 'string'), scannedAt: typeof value.scannedAt === 'string' ? value.scannedAt : null, hiddenBuilds, deletedModels };
    }
    loaded = true;
  }
  async function load() { loading ??= readState().catch((error: unknown) => { loading = null; throw error; }); await loading; }
  return {
    async status() {
      await load(); await refreshEngines();
      const locations = [...defaults, ...state.folders];
      // A build the user removed is kept out of the list, so it does not come
      // back on the next scan.
      const hidden = new Set(state.hiddenBuilds);
      const engines = state.engines.map((engine) => {
        if (!engine.builds?.length) return engine;
        const builds = engine.builds.filter((build) => !hidden.has(build));
        return builds.length === engine.builds.length ? engine : { ...engine, builds };
      });
      return { ...state, engines, locations: await Promise.all(locations.map(async (location) => ({ ...location, available: await stat(location.path).then((info) => info.isDirectory()).catch(() => false) }))) };
    },
    async add(folder: string) { await load(); if (!isAbsolute(folder)) throw new Error('Choose a folder.'); const canonical = await realpath(folder); if (!(await stat(canonical)).isDirectory() || dirname(canonical) === canonical) throw new Error('Choose a model folder, not a drive root.'); if (![...defaults, ...state.folders].some((item) => item.path === canonical)) state.folders.push({ id: identity(canonical), name: basename(canonical), path: canonical, extra: true }); await save(); },
    async remove(id: string) { await load(); if (state.folders.some((folder) => folder.id === id)) state.models = state.models.filter((model) => model.locationId !== id); state.folders = state.folders.filter((folder) => folder.id !== id); await save(); },
    async scan(signal?: AbortSignal) {
      await load();
      const result = await scanModelLocations([...state.folders, ...defaults], signal);
      const previous = new Map(state.models.map((model) => [model.id, model]));
      // A model the user deleted stays deleted: its file is still on disk,
      // but it must not come back on the next scan.
      const deleted = new Set(state.deletedModels);
      const engines = await detectEngines(signal, [...state.folders, ...defaults]);
      enginesCheckedAt = Date.now();
      state = { ...state, ...result, engines, models: result.models.filter((model) => !deleted.has(model.id)).map((model) => ({ ...model, ...(previous.get(model.id)?.importedModel ? { importedModel: previous.get(model.id)!.importedModel } : {}) })) };
      await save();
    },
    async model(id: string) { await load(); return state.models.find((item) => item.id === id) ?? null; },
    async candidate(id: string) { await load(); const model = state.models.find((item) => item.id === id); if (!model || model.issue || model.format !== 'GGUF' || await realpath(model.path) !== model.path || !(await hasGgufHeader(model.path))) throw new Error('Scan again; this model cannot be imported.'); return model; },
    async imported(id: string, name: string, canonical?: string) { const model = state.models.find((item) => item.id === id); if (model) { model.importedModel = name; if (canonical) model.importedCanonical = canonical; await save(); } },
    async removeModel(id: string) {
      await load();
      const model = state.models.find((item) => item.id === id);
      if (!model) throw new Error('This model is no longer listed. Scan again.');
      state.models = state.models.filter((item) => item.id !== id);
      // Tombstone the file so the next scan does not bring it back — the user
      // removed it deliberately, and its files staying on disk is the point.
      if (!state.deletedModels.includes(id)) state.deletedModels = [...state.deletedModels, id];
      await save();
      return model;
    },
    /**
     * A build the user no longer wants is only removed from the list; the
     * files on disk are the user's, so they are never touched.
     */
    async hideBuild(path: string) { await load(); if (!state.hiddenBuilds.includes(path)) { state.hiddenBuilds = [...state.hiddenBuilds, path]; await save(); } },
  };
}

