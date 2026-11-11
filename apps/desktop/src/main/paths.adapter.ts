/**
 * Electron main-process path helpers for AIR Office.
 *
 * Env vars set on the Normal service child (see service.ts):
 *   OFFICE_RESOURCE_ROOT, OFFICE_LAB_PACK_ROOT,
 *   OFFICE_SERVICE_INSTANCE_ID, OFFICE_LEMONADE_IMPORT_AUTHORIZATION,
 *   OFFICE_PORT, OFFICE_PUBLIC_SERVICE_BASE,
 *   OFFICE_STORAGE_CONFIG, OFFICE_RUNTIME_DIR, OFFICE_FILES_ROOT,
 *   OFFICE_DEFAULT_LOCAL_AI_DIR, OFFICE_LEMONADE_MODELS_DIR,
 *   OFFICE_CREDENTIALS_BRIDGE_URL, OFFICE_CREDENTIALS_BRIDGE_TOKEN,
 *   and when Lemonade is already running: OFFICE_LEMONADE_MODE,
 *   OFFICE_LEMONADE_INSTANCE_ID, OFFICE_LEMONADE_GENERATION,
 *   OFFICE_LEMONADE_RELEASE, OFFICE_LEMONADE_BASE_ORIGIN, OFFICE_LEMONADE_TOKEN.
 *
 * prepareStorage also sets OFFICE_DATA_ROOT (plus the storage path vars above).
 *
 * Demo service additionally sets OFFICE_DEMO_MODE, OFFICE_CREDENTIALS,
 * OFFICE_KEYCHAIN_SERVICE and clears OFFICE_LEMONADE_BASE_ORIGIN / OFFICE_LEMONADE_TOKEN.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let sessionId: string | undefined
let generation = 0

export function hostSessionId(): string {
  if (!sessionId) {
    sessionId = `air-${randomKey()}`
  }
  return sessionId
}

export function nextGeneration(): number {
  generation += 1
  return generation
}

export function randomKey(): string {
  return randomBytes(32).toString('hex')
}

/** Electron app data directory (holds storage-location.json). */
export function appDataDir(): string {
  return app.getPath('userData')
}

/**
 * `%LOCALAPPDATA%\\AIR Office\\{profile}` on Windows,
 * `~/Library/Application Support/AIR Office/{profile}` on macOS,
 * `~/.local/share/AIR Office/{profile}` on Linux.
 */
export function officeProfileRoot(profile: string): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || process.env.APPDATA
    if (local) {
      return path.join(local, 'AIR Office', profile)
    }
  } else if (process.platform === 'darwin') {
    const home = process.env.HOME || os.homedir()
    if (home) {
      return path.join(home, 'Library', 'Application Support', 'AIR Office', profile)
    }
  } else {
    const xdg = process.env.XDG_DATA_HOME
    if (xdg) {
      return path.join(xdg, 'AIR Office', profile)
    }
    const home = process.env.HOME || os.homedir()
    if (home) {
      return path.join(home, '.local', 'share', 'AIR Office', profile)
    }
  }
  return path.join(os.tmpdir(), 'AIR Office', profile)
}

function looksLikeResourcesTree(root: string): boolean {
  return (
    fs.existsSync(path.join(root, 'lab-pack')) ||
    fs.existsSync(path.join(root, 'lemonade')) ||
    fs.existsSync(path.join(root, 'code-server'))
  )
}

function firstExistingDir(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }
  return undefined
}

/**
 * Staged `resources/` tree. Packaged Electron uses `process.resourcesPath`
 * (with an optional nested `resources/` folder). Dev uses `apps/desktop/resources`.
 */
export function bundledResourcesDir(): string {
  if (app.isPackaged) {
    const root = process.resourcesPath
    const nested = path.join(root, 'resources')
    if (looksLikeResourcesTree(nested)) {
      return nested
    }
    if (looksLikeResourcesTree(root)) {
      return root
    }
    return nested
  }

  const preferred = firstExistingDir([path.join(DESKTOP_ROOT, 'resources')])
  if (preferred) {
    return preferred
  }
  return path.join(DESKTOP_ROOT, 'resources')
}

function serviceBinaryName(): string {
  return process.platform === 'win32' ? 'air-office-service.exe' : 'air-office-service'
}

function windowsTargetTriple(): string {
  return process.arch === 'arm64'
    ? 'aarch64-pc-windows-msvc'
    : 'x86_64-pc-windows-msvc'
}

function firstExistingFile(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return undefined
}

/**
 * Packaged sidecar under Electron `resourcesPath` (electron-builder
 * `extraResources`). A leftover beside the host exe is only a fallback so an
 * older install layout cannot shadow the current sidecar.
 * Dev looks under `apps/desktop/binaries/` (plain name and target-triple name).
 */
export function bundledServiceExecutable(): string {
  const name = serviceBinaryName()
  if (app.isPackaged) {
    const inResources = path.join(process.resourcesPath, name)
    const beside = path.join(path.dirname(process.execPath), name)
    return firstExistingFile([inResources, beside]) ?? inResources
  }

  const fromEnv = process.env.OFFICE_SERVICE_EXECUTABLE
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv
  }

  const binaryDir = path.join(DESKTOP_ROOT, 'binaries')
  const candidates: string[] = [path.join(binaryDir, name)]
  if (process.platform === 'win32') {
    candidates.push(path.join(binaryDir, `air-office-service-${windowsTargetTriple()}.exe`))
  } else if (process.platform === 'darwin') {
    const triple =
      process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    candidates.push(path.join(binaryDir, `air-office-service-${triple}`))
  } else {
    candidates.push(path.join(binaryDir, `air-office-service-${process.arch}-unknown-linux-gnu`))
  }
  return firstExistingFile(candidates) ?? path.join(binaryDir, name)
}

export function labPackDataRoot(resourcesDir = bundledResourcesDir()): string {
  return path.join(resourcesDir, 'lab-pack', 'data')
}

export function lemonadeImportAuthorizationPath(dataDir: string): string {
  return path.join(dataDir, 'lemonade', 'import-authorization.json')
}

export function desktopPackageRoot(): string {
  return DESKTOP_ROOT
}
