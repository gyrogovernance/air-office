import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { credentialsBridgeEnv } from './credentials-bridge.adapter'
import {
  bundledResourcesDir,
  bundledServiceExecutable,
  hostSessionId,
  labPackDataRoot,
  nextGeneration,
  officeProfileRoot,
} from './paths.adapter'
import {
  isChildRunning,
  spawnManaged,
  type ManagedChild,
} from './supervise.adapter'

export type DemoServiceEndpoint = {
  generation: number
  port: number
  base: string
}

type ManagedDemoService = {
  generation: number
  port: number
  managed: ManagedChild
}

let demo: ManagedDemoService | undefined

function demoDataRoot(): string {
  return officeProfileRoot('Demo')
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
    throw new Error('Could not inspect Demo port.')
  }
  return {
    port: address.port,
    release: () => {
      server.close()
    },
  }
}

async function waitDemoReady(
  base: string,
  generation: number,
): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() <= deadline) {
    const current = demo
    if (!current || current.generation !== generation) {
      throw new Error(
        current
          ? 'The Demo service was replaced.'
          : 'The Demo service is not running.',
      )
    }
    if (!isChildRunning(current.managed.child)) {
      throw new Error('The Demo service stopped during startup.')
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const response = await fetch(`${base}/health`, {
        signal: controller.signal,
        redirect: 'manual',
      })
      clearTimeout(timer)
      if (response.ok) {
        const body = (await response.json()) as {
          ready?: boolean
          demo?: boolean
        }
        if (body.ready === true && body.demo === true) {
          return
        }
        if (body.ready === true) {
          throw new Error(
            'A normal service is using this port. Restart AIR Office and try Demo again.',
          )
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('normal service is using this port')
      ) {
        throw error
      }
    }
    await delay(200)
  }
  throw new Error('The Demo service did not become ready.')
}

export async function demoServiceStatus(): Promise<DemoServiceEndpoint | null> {
  if (!demo) {
    return null
  }
  if (!isChildRunning(demo.managed.child)) {
    demo = undefined
    return null
  }
  return {
    generation: demo.generation,
    port: demo.port,
    base: `http://127.0.0.1:${demo.port}`,
  }
}

export async function startDemoService(): Promise<DemoServiceEndpoint> {
  if (demo && isChildRunning(demo.managed.child)) {
    const endpoint: DemoServiceEndpoint = {
      generation: demo.generation,
      port: demo.port,
      base: `http://127.0.0.1:${demo.port}`,
    }
    await waitDemoReady(endpoint.base, endpoint.generation)
    return endpoint
  }
  if (demo) {
    demo = undefined
  }

  const reserved = await reserveLoopbackPort()
  const root = demoDataRoot()
  const privateRoot = path.join(root, 'private')
  const workspace = path.join(privateRoot, 'workspace')
  const files = path.join(privateRoot, 'files')
  const models = path.join(root, 'models')
  fs.mkdirSync(files, { recursive: true })
  fs.mkdirSync(workspace, { recursive: true })
  fs.mkdirSync(models, { recursive: true })

  const storageConfig = path.join(root, 'storage-location.json')
  const resources = bundledResourcesDir()
  const generation = nextGeneration()
  const executable = bundledServiceExecutable()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OFFICE_DEMO_MODE: '1',
    OFFICE_DATA_ROOT: root,
    OFFICE_STORAGE_CONFIG: storageConfig,
    OFFICE_RUNTIME_DIR: workspace,
    OFFICE_FILES_ROOT: files,
    OFFICE_DEFAULT_LOCAL_AI_DIR: models,
    OFFICE_LEMONADE_MODELS_DIR: models,
    OFFICE_RESOURCE_ROOT: resources,
    OFFICE_LAB_PACK_ROOT: labPackDataRoot(resources),
    OFFICE_CREDENTIALS: 'environment',
    OFFICE_KEYCHAIN_SERVICE: 'air-office/demo-provider',
    OFFICE_PORT: String(reserved.port),
    OFFICE_PUBLIC_SERVICE_BASE: `http://127.0.0.1:${reserved.port}`,
    OFFICE_SERVICE_INSTANCE_ID: `demo:${hostSessionId()}:${generation}`,
    ...credentialsBridgeEnv(),
  }
  delete env.OFFICE_LEMONADE_BASE_ORIGIN
  delete env.OFFICE_LEMONADE_TOKEN

  try {
    const managed = spawnManaged(executable, { env })
    const endpoint: DemoServiceEndpoint = {
      generation,
      port: reserved.port,
      base: `http://127.0.0.1:${reserved.port}`,
    }
    demo = { generation, port: reserved.port, managed }
    reserved.release()
    try {
      await waitDemoReady(endpoint.base, endpoint.generation)
    } catch (error) {
      await stopDemoService()
      throw error
    }
    return endpoint
  } catch (error) {
    reserved.release()
    throw error
  }
}

export async function stopDemoService(): Promise<void> {
  const current = demo
  demo = undefined
  if (!current) {
    return
  }
  await current.managed.kill()
}
