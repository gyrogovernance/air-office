/**
 * Runs electron-vite with the Intel-Mac Electron 43 override when present.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMacIntelHost, resolveElectronVersion } from './electron-version.adapter'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const env = { ...process.env }

function ensureElectronReady(): void {
  const ensure = spawnSync(process.execPath, ['run', 'scripts/ensure-electron.entry.ts'], {
    cwd: desktopRoot,
    stdio: 'inherit',
    env,
  })
  if (ensure.status !== 0) process.exit(ensure.status ?? 1)
}

const packageDist = join(desktopRoot, 'node_modules', 'electron', 'dist')
const packagePathTxt = join(desktopRoot, 'node_modules', 'electron', 'path.txt')
if (!existsSync(packageDist) || !existsSync(packagePathTxt) || isMacIntelHost()) {
  ensureElectronReady()
}

if (isMacIntelHost()) {
  const version = resolveElectronVersion('host')
  const electronPkg = join(desktopRoot, '.electron-host', version, 'node_modules', 'electron')
  const dist = join(electronPkg, 'dist')
  const pathTxt = join(electronPkg, 'path.txt')
  if (existsSync(dist) && existsSync(pathTxt)) {
    // electron-vite resolves the binary via ELECTRON_EXEC_PATH (or path.txt under
    // require('electron')), not ELECTRON_OVERRIDE_DIST_PATH. Set both.
    const relative = readFileSync(pathTxt, 'utf8').trim()
    const execPath = join(dist, relative)
    env.ELECTRON_OVERRIDE_DIST_PATH = dist
    env.ELECTRON_EXEC_PATH = execPath
    console.info(`Intel Mac: electron-vite → Electron ${version} (${execPath})`)
  }
}

const result = spawnSync('bunx', ['electron-vite', ...args], {
  cwd: desktopRoot,
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})
process.exit(result.status ?? 1)
