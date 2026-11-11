import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export type ManagedChild = {
  child: ChildProcess
  pid: number
  kill: () => Promise<void>
}

export type SpawnManagedOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  args?: string[]
}

export function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

export async function killProcessTree(pid: number): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return
  }
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  await delay(500)
  try {
    process.kill(pid, 0)
  } catch {
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already gone
  }
}

export function spawnManaged(
  executable: string,
  options: SpawnManagedOptions = {},
): ManagedChild {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    // Pipe stderr so a crash during waitReady is visible in the Electron log.
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  }
  const child = spawn(executable, options.args ?? [], spawnOptions)
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn ${executable}`)
  }
  const pid = child.pid
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) console.error(`[sidecar ${pid}] ${text}`)
  })
  child.on('exit', (code, signal) => {
    console.error(`[sidecar ${pid}] exited code=${code} signal=${signal}`)
  })
  return {
    child,
    pid,
    kill: async () => {
      await killProcessTree(pid)
      if (isChildRunning(child)) {
        child.kill('SIGKILL')
      }
    },
  }
}

export async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (!isChildRunning(child)) {
    return true
  }
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}
