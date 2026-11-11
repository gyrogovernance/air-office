import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  bundledResourcesDir,
  hostSessionId,
  nextGeneration,
  randomKey,
} from './paths.adapter'
import { dataDir, paths as storagePaths } from './storage.adapter'
import {
  isChildRunning,
  spawnManaged,
  type ManagedChild,
} from './supervise.adapter'

export const LEMONADE_RELEASE = '2026.42.1'
const DEFAULT_CONTEXT_TOKENS = 16384
const RUNTIME_SLOT_PREFIX = 'runtime-'

export type LemonadeEndpoint = {
  generation: number
  port: number
  base: string
  release: string
}

export type LemonadeBootstrapStatus = {
  kind: 'embedded'
  generation: number | null
  baseOrigin: string | null
  release: string
  state: 'stopped' | 'loading' | 'ready' | 'unavailable' | 'error'
}

type ManagedLemonade = {
  generation: number
  port: number
  key: string
  release: string
  managed: ManagedChild
}

let runtime: ManagedLemonade | undefined

function runtimeRoot(dataRoot: string): string {
  return path.join(dataRoot, 'lemonade')
}

function runtimeExecutable(root: string): string {
  return path.join(
    root,
    process.platform === 'win32' ? 'lemond.exe' : 'lemond',
  )
}

function validateVersion(version: string): void {
  if (
    !version ||
    version.length > 64 ||
    !/^[A-Za-z0-9.-]+$/.test(version) ||
    version === '.' ||
    version === '..'
  ) {
    throw new Error('The runtime version is invalid.')
  }
}

function validatedSlot(dataRoot: string, version: string): string {
  validateVersion(version)
  const slot = path.join(
    runtimeRoot(dataRoot),
    `${RUNTIME_SLOT_PREFIX}${version}`,
  )
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(slot)
  } catch {
    throw new Error('The runtime slot is unavailable.')
  }
  if (stat.isSymbolicLink()) {
    throw new Error('Runtime slot links are not allowed.')
  }
  const recorded = fs.readFileSync(path.join(slot, 'VERSION'), 'utf8').trim()
  if (recorded !== version || !fs.existsSync(runtimeExecutable(slot))) {
    throw new Error('The runtime slot identity is incomplete or mismatched.')
  }
  return slot
}

function copyRuntimeTree(source: string, destination: string): void {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const target = path.join(destination, entry.name)
    const from = path.join(source, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(target)
      copyRuntimeTree(from, target)
    } else if (entry.isFile()) {
      fs.copyFileSync(from, target)
    } else {
      throw new Error(
        'The bundled runtime contains an unsupported filesystem entry.',
      )
    }
  }
}

function stageRuntime(
  dataRoot: string,
  bundled: string,
  version: string,
): string {
  validateVersion(version)
  const root = runtimeRoot(dataRoot)
  fs.mkdirSync(root, { recursive: true })
  const destination = path.join(root, `${RUNTIME_SLOT_PREFIX}${version}`)
  if (fs.existsSync(destination)) {
    return validatedSlot(dataRoot, version)
  }
  const staging = path.join(
    root,
    `.${RUNTIME_SLOT_PREFIX}${version}.staging-${nextGeneration()}`,
  )
  fs.mkdirSync(staging)
  try {
    copyRuntimeTree(bundled, staging)
    if (!fs.existsSync(runtimeExecutable(staging))) {
      throw new Error('The staged runtime is missing its server executable.')
    }
    fs.writeFileSync(path.join(staging, 'VERSION'), version)
    fs.renameSync(staging, destination)
    return destination
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

function writeRuntimeRecord(
  root: string,
  name: string,
  version: string,
): void {
  validateVersion(version)
  const next = path.join(root, `${name}.next`)
  const target = path.join(root, name)
  fs.writeFileSync(next, version)
  const backup = path.join(root, `${name}.backup`)
  if (fs.existsSync(backup)) {
    fs.unlinkSync(backup)
  }
  if (fs.existsSync(target)) {
    fs.renameSync(target, backup)
  }
  try {
    fs.renameSync(next, target)
  } catch (error) {
    if (fs.existsSync(backup)) {
      try {
        fs.renameSync(backup, target)
      } catch {
        // best effort restore
      }
    }
    throw new Error(
      `Could not replace runtime record: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function switchRuntime(dataRoot: string, version: string): void {
  validatedSlot(dataRoot, version)
  writeRuntimeRecord(runtimeRoot(dataRoot), 'active', version)
}

function activeRuntime(dataRoot: string): string {
  const version = fs
    .readFileSync(path.join(runtimeRoot(dataRoot), 'active'), 'utf8')
    .trim()
  return validatedSlot(dataRoot, version)
}

/**
 * Flip Windows console PE helpers from CUI to GUI so child backends stay silent.
 * TODO: consider extracting to a shared packaging helper if staging moves out of main.
 */
function silenceWindowsConsoleHelpers(root: string): void {
  if (process.platform !== 'win32') {
    return
  }
  const visit = (directory: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(full)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) {
        continue
      }
      let bytes: Buffer
      try {
        bytes = fs.readFileSync(full)
      } catch {
        continue
      }
      if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
        continue
      }
      const pe =
        bytes[0x3c]! |
        (bytes[0x3d]! << 8) |
        (bytes[0x3e]! << 16) |
        (bytes[0x3f]! << 24)
      if (
        pe + 0x5e > bytes.length ||
        bytes[pe] !== 0x50 ||
        bytes[pe + 1] !== 0x45 ||
        bytes[pe + 2] !== 0 ||
        bytes[pe + 3] !== 0
      ) {
        continue
      }
      const subsystem = pe + 0x5c
      if (bytes[subsystem] !== 3 || bytes[subsystem + 1] !== 0) {
        continue
      }
      bytes[subsystem] = 2
      try {
        fs.writeFileSync(full, bytes)
      } catch {
        // leave file unchanged when locked
      }
    }
  }
  visit(root)
}

function initializeModelsDirectory(
  resource: string,
  modelDir: string,
): void {
  const configPath = path.join(resource, 'config.json')
  let original: Buffer | undefined
  let config: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    original = fs.readFileSync(configPath)
    try {
      const parsed = JSON.parse(original.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Local AI configuration must be an object.')
      }
      config = parsed as Record<string, unknown>
    } catch {
      throw new Error(
        'Local AI configuration is invalid. Restore it before starting.',
      )
    }
  }
  let changed = false
  if (!Object.prototype.hasOwnProperty.call(config, 'ctx_size')) {
    config.ctx_size = DEFAULT_CONTEXT_TOKENS
    changed = true
  }
  const modelsDirValue = config.models_dir
  const modelsDirIsChosen =
    typeof modelsDirValue === 'string' &&
    modelsDirValue !== 'auto' &&
    modelsDirValue.length > 0
  if (!modelsDirIsChosen) {
    config.models_dir = modelDir
    changed = true
  }
  if (!changed) {
    return
  }
  if (original) {
    const backup = path.join(resource, 'config.before-private-models.json')
    if (!fs.existsSync(backup)) {
      fs.writeFileSync(backup, original)
    }
  }
  const temporary = path.join(resource, 'config.private-models.tmp')
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`)
  fs.renameSync(temporary, configPath)
}

function runtimeWorkingDirectory(
  dataRoot: string,
  oldSlot: string,
): string {
  const working = path.join(runtimeRoot(dataRoot), 'state')
  if (fs.existsSync(working)) {
    return working
  }
  const staging = path.join(
    runtimeRoot(dataRoot),
    `.state-staging-${nextGeneration()}`,
  )
  fs.mkdirSync(staging)
  const skip = new Set([
    'VERSION',
    'resources',
    'LICENSE',
    'lemond',
    'lemond.exe',
    'lemonade',
    'lemonade.exe',
  ])
  for (const entry of fs.readdirSync(oldSlot, { withFileTypes: true })) {
    if (skip.has(entry.name)) {
      continue
    }
    const from = path.join(oldSlot, entry.name)
    const target = path.join(staging, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(target)
      copyRuntimeTree(from, target)
    } else if (entry.isFile()) {
      fs.copyFileSync(from, target)
    } else {
      throw new Error('Runtime state links cannot be migrated.')
    }
  }
  fs.renameSync(staging, working)
  return working
}

function resolveActiveSlot(dataRoot: string): string {
  const bundled = path.join(bundledResourcesDir(), 'lemonade')
  try {
    return activeRuntime(dataRoot)
  } catch (error) {
    const activePath = path.join(runtimeRoot(dataRoot), 'active')
    if (fs.existsSync(activePath)) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    const backup = path.join(runtimeRoot(dataRoot), 'active.backup')
    if (fs.existsSync(backup)) {
      const version = fs.readFileSync(backup, 'utf8').trim()
      validatedSlot(dataRoot, version)
      switchRuntime(dataRoot, version)
      return validatedSlot(dataRoot, version)
    }
    if (!fs.existsSync(bundled)) {
      // TODO: full packaging-time stage when Electron resources/lemonade is absent.
      throw new Error(
        `The pinned Lemonade ${LEMONADE_RELEASE} runtime is not packaged for this target.`,
      )
    }
    const staged = stageRuntime(dataRoot, bundled, LEMONADE_RELEASE)
    // TODO: port verify_staged_bundle byte-for-byte check from Rust when packaging CI lands.
    switchRuntime(dataRoot, LEMONADE_RELEASE)
    return staged
  }
}

async function reserveLoopbackPort(): Promise<{
  port: number
  release: () => void
}> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not inspect Lemonade port.')
  }
  return {
    port: address.port,
    release: () => {
      server.close()
    },
  }
}

function healthState(bytes: Buffer): LemonadeBootstrapStatus['state'] {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as {
      status?: string
      ready?: boolean
    }
    if (value.status === 'ok' || value.status === 'ready') {
      return 'ready'
    }
    if (value.status === 'loading' || value.status === 'starting') {
      return 'loading'
    }
    if (value.ready === true) {
      return 'ready'
    }
    return 'error'
  } catch {
    return 'error'
  }
}

async function boundedHealth(
  url: string,
  key?: string,
): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      redirect: 'manual',
    })
    if (!response.ok) {
      throw new Error('Health request was rejected.')
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 65536) {
      throw new Error('Health response exceeds the limit.')
    }
    return buffer
  } finally {
    clearTimeout(timer)
  }
}

async function probeLemonadeHealth(
  port: number,
  key: string,
): Promise<LemonadeBootstrapStatus['state']> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 800)
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}` },
      redirect: 'manual',
    })
    clearTimeout(timer)
    if (!response.ok && response.status !== 503) {
      return 'error'
    }
    const loading = response.status === 503
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 65536) {
      return 'error'
    }
    const state = healthState(buffer)
    if (loading && state === 'ready') {
      return 'loading'
    }
    return state
  } catch {
    return 'unavailable'
  }
}

async function waitLemonadeReady(endpoint: LemonadeEndpoint): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const current = runtime
    if (!current || current.generation !== endpoint.generation) {
      throw new Error('Local AI ownership changed during startup.')
    }
    if (!isChildRunning(current.managed.child)) {
      throw new Error('The owned runtime exited during startup.')
    }
    try {
      const bytes = await boundedHealth(
        `http://127.0.0.1:${endpoint.port}/v1/health`,
        current.key,
      )
      if (healthState(bytes) === 'ready') {
        return
      }
    } catch {
      // keep polling
    }
    await delay(100)
  }
  throw new Error(
    'The owned Lemonade process did not become ready on its reserved loopback port.',
  )
}

export function getLemonadeServiceEnv(): Record<string, string> | null {
  if (!runtime || !isChildRunning(runtime.managed.child)) {
    return null
  }
  return {
    OFFICE_LEMONADE_MODE: 'embedded',
    OFFICE_LEMONADE_INSTANCE_ID: hostSessionId(),
    OFFICE_LEMONADE_GENERATION: String(runtime.generation),
    OFFICE_LEMONADE_RELEASE: runtime.release,
    OFFICE_LEMONADE_BASE_ORIGIN: `http://127.0.0.1:${runtime.port}`,
    OFFICE_LEMONADE_TOKEN: runtime.key,
  }
}

export async function lemonadeStatus(): Promise<LemonadeBootstrapStatus> {
  if (!runtime) {
    return {
      kind: 'embedded',
      generation: null,
      baseOrigin: null,
      release: LEMONADE_RELEASE,
      state: 'stopped',
    }
  }
  if (!isChildRunning(runtime.managed.child)) {
    runtime = undefined
    return {
      kind: 'embedded',
      generation: null,
      baseOrigin: null,
      release: LEMONADE_RELEASE,
      state: 'stopped',
    }
  }
  const snapshot: LemonadeBootstrapStatus = {
    kind: 'embedded',
    generation: runtime.generation,
    baseOrigin: `http://127.0.0.1:${runtime.port}`,
    release: runtime.release,
    state: 'loading',
  }
  snapshot.state = await probeLemonadeHealth(runtime.port, runtime.key)
  if (!runtime || !isChildRunning(runtime.managed.child)) {
    snapshot.state = 'stopped'
  }
  return snapshot
}

export async function startLemonade(): Promise<LemonadeEndpoint> {
  if (runtime && isChildRunning(runtime.managed.child)) {
    const endpoint: LemonadeEndpoint = {
      generation: runtime.generation,
      port: runtime.port,
      base: `http://127.0.0.1:${runtime.port}`,
      release: runtime.release,
    }
    await waitLemonadeReady(endpoint)
    return endpoint
  }
  if (runtime) {
    runtime = undefined
  }

  const dataRoot = dataDir()
  const active = resolveActiveSlot(dataRoot)
  const executable = runtimeExecutable(active)
  const release = fs.readFileSync(path.join(active, 'VERSION'), 'utf8').trim()
  const resource = runtimeWorkingDirectory(dataRoot, active)
  if (!fs.existsSync(executable)) {
    throw new Error(
      `The pinned Lemonade ${LEMONADE_RELEASE} runtime is not packaged for this target.`,
    )
  }
  silenceWindowsConsoleHelpers(resource)
  silenceWindowsConsoleHelpers(active)

  const reserved = await reserveLoopbackPort()
  const key = randomKey()
  const modelDir = storagePaths().models
  try {
    initializeModelsDirectory(resource, modelDir)
    fs.mkdirSync(modelDir, { recursive: true })
    const temporary = path.join(modelDir, 'tmp')
    fs.mkdirSync(temporary, { recursive: true })
    const managed = spawnManaged(executable, {
      cwd: resource,
      args: ['./', '--port', String(reserved.port)],
      env: {
        ...process.env,
        LEMONADE_API_KEY: key,
        LEMONADE_DISABLE_BROADCAST: '1',
        HF_HOME: path.join(modelDir, 'hf-home'),
        HF_HUB_CACHE: modelDir,
        LEMONADE_CACHE_DIR: path.join(modelDir, 'runtime-cache'),
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
      },
    })
    const generation = nextGeneration()
    const endpoint: LemonadeEndpoint = {
      generation,
      port: reserved.port,
      base: `http://127.0.0.1:${reserved.port}`,
      release,
    }
    runtime = {
      generation,
      port: reserved.port,
      key,
      release,
      managed,
    }
    reserved.release()
    try {
      await waitLemonadeReady(endpoint)
    } catch (error) {
      const current = runtime
      if (current && current.generation === generation) {
        await current.managed.kill()
        runtime = undefined
      }
      throw error
    }
    return endpoint
  } catch (error) {
    reserved.release()
    throw error
  }
}

export async function stopLemonade(generation?: number): Promise<void> {
  const current = runtime
  if (!current) {
    return
  }
  if (generation !== undefined && current.generation !== generation) {
    throw new Error('The runtime generation is stale.')
  }
  runtime = undefined
  await current.managed.kill()
  await delay(50)
}

function rollbackVersion(dataRoot: string): string {
  const backup = path.join(runtimeRoot(dataRoot), 'active.backup')
  if (!fs.existsSync(backup)) {
    throw new Error('No previous Local AI runtime is available to restore.')
  }
  return fs.readFileSync(backup, 'utf8').trim()
}

/** Stop owned Lemonade, switch active slot to the pinned release, restart. */
export async function activateLemonadeRuntime(generation: number): Promise<void> {
  if (runtime && runtime.generation !== generation) {
    throw new Error('The runtime generation is stale.')
  }
  if (runtime) {
    await stopLemonade(runtime.generation)
  }
  const dataRoot = dataDir()
  const bundled = path.join(bundledResourcesDir(), 'lemonade')
  const staged = stageRuntime(dataRoot, bundled, LEMONADE_RELEASE)
  // TODO: port verify_staged_bundle byte-for-byte check from Rust when packaging CI lands.
  if (!fs.existsSync(runtimeExecutable(staged))) {
    throw new Error('The staged runtime is missing its server executable.')
  }
  switchRuntime(dataRoot, LEMONADE_RELEASE)
  await startLemonade()
}

/** Stop owned Lemonade, restore previous slot, restart. */
export async function rollbackLemonadeRuntime(generation: number): Promise<void> {
  if (runtime && runtime.generation !== generation) {
    throw new Error('The runtime generation is stale.')
  }
  if (runtime) {
    await stopLemonade(runtime.generation)
  }
  const dataRoot = dataDir()
  const version = rollbackVersion(dataRoot)
  validatedSlot(dataRoot, version)
  switchRuntime(dataRoot, version)
  await startLemonade()
}
