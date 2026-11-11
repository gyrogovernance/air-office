import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  getLemonadeServiceEnv,
  lemonadeStatus,
  stopLemonade,
  type LemonadeBootstrapStatus,
} from './lemonade.adapter'
import { credentialsBridgeEnv } from './credentials-bridge.adapter'
import { hostControlEnv } from './host-control.adapter'
import {
  bundledResourcesDir,
  bundledServiceExecutable,
  hostSessionId,
  labPackDataRoot,
  lemonadeImportAuthorizationPath,
  nextGeneration,
} from './paths.adapter'
import { dataDir, paths as storagePaths, prepareStorage, storageConfigPath } from './storage.adapter'
import {
  isChildRunning,
  spawnManaged,
  type ManagedChild,
} from './supervise.adapter'

export type ServiceEndpoint = {
  generation: number
  port: number
  base: string
}

export type ServiceLaunch = {
  executable?: string
  workingDirectory?: string
}

export type BootstrapDescriptor = {
  service_base: string
  lemonade: {
    kind: string
    generation: number | null
    base_origin: string | null
    release: string
    state: string
  }
}

type ManagedService = {
  generation: number
  lemonadeGeneration: number | null
  port: number
  managed: ManagedChild
  launch: ServiceLaunch
}

let service: ManagedService | undefined

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
    throw new Error('Could not inspect reserved port.')
  }
  return {
    port: address.port,
    release: () => {
      server.close()
    },
  }
}

async function boundedHealth(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
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

function serviceHealthMatches(bytes: Buffer, generation: number): boolean {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as {
      ready?: boolean
      instanceId?: string
    }
    const expected = `${hostSessionId()}:${generation}`
    return value.ready === true && value.instanceId === expected
  } catch {
    return false
  }
}

async function waitReady(base: string, generation: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = service
    if (!current || current.generation !== generation) {
      throw new Error('Service ownership changed during startup.')
    }
    if (!isChildRunning(current.managed.child)) {
      throw new Error('The owned service exited during startup.')
    }
    try {
      const bytes = await boundedHealth(`${base}/health`)
      if (serviceHealthMatches(bytes, generation)) {
        return
      }
    } catch {
      // keep polling
    }
    await delay(50)
  }
  throw new Error('The AIR Office service did not become ready.')
}

function resolveExecutable(launch: ServiceLaunch): string {
  return (
    launch.executable ||
    process.env.OFFICE_SERVICE_EXECUTABLE ||
    bundledServiceExecutable()
  )
}

export async function serviceStatus(): Promise<ServiceEndpoint | null> {
  if (!service) {
    return null
  }
  if (!isChildRunning(service.managed.child)) {
    service = undefined
    return null
  }
  return {
    generation: service.generation,
    port: service.port,
    base: `http://127.0.0.1:${service.port}`,
  }
}

/**
 * Starts the Normal air-office-service on an ephemeral loopback port.
 * Does not start Lemonade; when Lemonade is already running its env is attached.
 */
export async function startService(
  launch: ServiceLaunch = {},
): Promise<ServiceEndpoint> {
  if (service && isChildRunning(service.managed.child)) {
    const endpoint: ServiceEndpoint = {
      generation: service.generation,
      port: service.port,
      base: `http://127.0.0.1:${service.port}`,
    }
    await waitReady(endpoint.base, endpoint.generation)
    return endpoint
  }
  if (service) {
    service = undefined
  }

  const executable = resolveExecutable(launch)
  await prepareStorage(executable)

  const reserved = await reserveLoopbackPort()
  const generation = nextGeneration()
  const storage = storagePaths()
  const resources = bundledResourcesDir()
  const lemonadeEnv = getLemonadeServiceEnv()
  const lemonadeGeneration = lemonadeEnv
    ? Number(lemonadeEnv.OFFICE_LEMONADE_GENERATION)
    : null

  try {
    const managed = spawnManaged(executable, {
      cwd: launch.workingDirectory,
      env: {
        ...process.env,
        OFFICE_RESOURCE_ROOT: resources,
        OFFICE_LAB_PACK_ROOT: labPackDataRoot(resources),
        OFFICE_SERVICE_INSTANCE_ID: `${hostSessionId()}:${generation}`,
        OFFICE_LEMONADE_IMPORT_AUTHORIZATION: lemonadeImportAuthorizationPath(
          dataDir(),
        ),
        OFFICE_PORT: String(reserved.port),
        OFFICE_PUBLIC_SERVICE_BASE: `http://127.0.0.1:${reserved.port}`,
        OFFICE_STORAGE_CONFIG: storageConfigPath(),
        OFFICE_RUNTIME_DIR: storage.workspace,
        OFFICE_FILES_ROOT: storage.files,
        OFFICE_DEFAULT_LOCAL_AI_DIR: storage.localAi,
        OFFICE_LEMONADE_MODELS_DIR: storage.models,
        ...credentialsBridgeEnv(),
        ...hostControlEnv(),
        ...(lemonadeEnv ?? {}),
      },
    })
    const endpoint: ServiceEndpoint = {
      generation,
      port: reserved.port,
      base: `http://127.0.0.1:${reserved.port}`,
    }
    service = {
      generation,
      lemonadeGeneration:
        lemonadeGeneration !== null && Number.isFinite(lemonadeGeneration)
          ? lemonadeGeneration
          : null,
      port: reserved.port,
      managed,
      launch,
    }
    reserved.release()
    try {
      await waitReady(endpoint.base, endpoint.generation)
    } catch (error) {
      const current = service
      if (current && current.generation === generation) {
        await current.managed.kill()
        service = undefined
      }
      throw error
    }
    return endpoint
  } catch (error) {
    reserved.release()
    throw error
  }
}

export async function stopService(generation?: number): Promise<void> {
  const current = service
  if (!current) {
    return
  }
  if (generation !== undefined && current.generation !== generation) {
    throw new Error('The service generation is stale.')
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (attempt === 0) {
      await current.managed.kill()
    }
    if (!isChildRunning(current.managed.child)) {
      if (service?.generation === current.generation) {
        service = undefined
      }
      return
    }
    await delay(50)
  }
  throw new Error(
    'Service shutdown did not finish; cleanup ownership was retained.',
  )
}

export async function restartDesktopServices(generation?: number): Promise<BootstrapDescriptor> {
  const lemonadeGen = getLemonadeServiceEnv()?.OFFICE_LEMONADE_GENERATION
  const owned = lemonadeGen ? Number(lemonadeGen) : service?.lemonadeGeneration ?? undefined
  if (generation !== undefined && owned !== undefined && generation !== owned) {
    throw new Error('The runtime generation is stale. Refresh before restarting.')
  }
  if (service) {
    await stopService(service.generation)
  }
  if (owned !== undefined) {
    try {
      await stopLemonade(owned)
    } catch {
      /* already stopped */
    }
  }
  await startService()
  return publishBootstrap()
}

/** Bootstrap descriptor for the renderer. Lemonade may be stopped / absent. */
export async function publishBootstrap(): Promise<BootstrapDescriptor> {
  const current = service
  if (!current || !isChildRunning(current.managed.child)) {
    throw new Error('The owned AIR service has not started.')
  }
  let lemonade: LemonadeBootstrapStatus
  try {
    lemonade = await lemonadeStatus()
  } catch {
    lemonade = {
      kind: 'embedded',
      generation: null,
      baseOrigin: null,
      release: 'absent',
      state: 'stopped',
    }
  }
  return {
    service_base: `http://127.0.0.1:${current.port}`,
    lemonade: {
      kind: lemonade.kind,
      generation: lemonade.generation,
      base_origin: lemonade.baseOrigin,
      release: lemonade.release,
      state: lemonade.state,
    },
  }
}
