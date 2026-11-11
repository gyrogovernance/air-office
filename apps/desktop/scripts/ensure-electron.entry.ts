/**
 * Ensures the Electron binary used for `electron-vite` / local native matches
 * this host. Intel Mac → 43.8.4 (WebGPU). Everything else → package.json 45.x.
 *
 * Packaged apps use electron-builder `-c.electronVersion=` per target and do
 * not rely on this override folder.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMacIntelHost, resolveElectronVersion } from './electron-version.adapter'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const overrideRoot = join(desktopRoot, '.electron-host')
const markerPath = join(overrideRoot, 'version.txt')
const want = resolveElectronVersion('host')

function installedPackageVersion(): string | null {
  try {
    return JSON.parse(readFileSync(join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8')).version as string
  } catch {
    return null
  }
}

function overrideDistPath(): string | null {
  if (!existsSync(markerPath)) return null
  if (readFileSync(markerPath, 'utf8').trim() !== want) return null
  const dist = join(overrideRoot, want, 'dist')
  return existsSync(dist) ? dist : null
}

function writeOverrideEnv(dist: string): void {
  const pathTxt = join(dist, '..', 'path.txt')
  const relative = existsSync(pathTxt) ? readFileSync(pathTxt, 'utf8').trim() : 'Electron.app/Contents/MacOS/Electron'
  const execPath = join(dist, relative)
  writeFileSync(
    join(overrideRoot, 'env.sh'),
    `export ELECTRON_OVERRIDE_DIST_PATH=${JSON.stringify(dist)}\nexport ELECTRON_EXEC_PATH=${JSON.stringify(execPath)}\n`,
  )
  writeFileSync(
    join(overrideRoot, 'env.ps1'),
    `$env:ELECTRON_OVERRIDE_DIST_PATH = ${JSON.stringify(dist)}\n$env:ELECTRON_EXEC_PATH = ${JSON.stringify(execPath)}\n`,
  )
}

/** Populate apps/desktop/.electron-host/<ver> with a full electron package install. */
function materializeOverride(version: string): string {
  const staging = join(overrideRoot, version)
  const dist = join(staging, 'node_modules', 'electron', 'dist')
  mkdirSync(overrideRoot, { recursive: true })
  if (existsSync(dist) && existsSync(join(staging, 'node_modules', 'electron', 'path.txt'))) {
    writeFileSync(markerPath, `${version}\n`)
    writeOverrideEnv(dist)
    return dist
  }
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  writeFileSync(
    join(staging, 'package.json'),
    `${JSON.stringify({ name: 'air-office-electron-host', private: true, dependencies: { electron: version } }, null, 2)}\n`,
  )
  const install = spawnSync('bun', ['install'], { cwd: staging, stdio: 'inherit' })
  if (install.status !== 0) {
    throw new Error(`Failed to download Electron ${version} for this host.`)
  }
  const electronPkg = join(staging, 'node_modules', 'electron')
  if (!existsSync(dist)) {
    // bun may skip lifecycle scripts; run Electron's own binary fetch.
    const fetchBinary = spawnSync(process.execPath, [join(electronPkg, 'install.js')], {
      cwd: electronPkg,
      stdio: 'inherit',
      env: { ...process.env, npm_config_cache: join(staging, '.npm-cache') },
    })
    if (fetchBinary.status !== 0 || !existsSync(dist)) {
      throw new Error(`Electron ${version} installed without a dist/ folder.`)
    }
  }
  writeFileSync(markerPath, `${version}\n`)
  writeOverrideEnv(dist)
  console.info(`Electron host override ready: ${version} → ${dist}`)
  return dist
}

/** Bun often skips npm lifecycle scripts, so electron's dist/ may be absent. */
function ensurePackageBinary(): void {
  const electronPkg = join(desktopRoot, 'node_modules', 'electron')
  const dist = join(electronPkg, 'dist')
  const pathTxt = join(electronPkg, 'path.txt')
  if (existsSync(dist) && existsSync(pathTxt)) return
  if (!existsSync(join(electronPkg, 'install.js'))) {
    throw new Error('Electron package is missing. Run bun install in apps/desktop.')
  }
  const fetchBinary = spawnSync(process.execPath, [join(electronPkg, 'install.js')], {
    cwd: electronPkg,
    stdio: 'inherit',
  })
  if (fetchBinary.status !== 0 || !existsSync(dist) || !existsSync(pathTxt)) {
    throw new Error('Electron package is present but its binary could not be downloaded.')
  }
  console.info(`Electron binary ready under ${dist}`)
}

const have = installedPackageVersion()
if (isMacIntelHost()) {
  const dist = materializeOverride(want)
  console.info(`Intel Mac: local native uses Electron ${want} (override). Package declares ${have ?? 'unknown'} for other hosts.`)
  // Export for this process tree when sourced; electron-vite wrapper also reads the marker.
  process.env.ELECTRON_OVERRIDE_DIST_PATH = dist
  const pathTxt = join(dist, '..', 'path.txt')
  const relative = existsSync(pathTxt) ? readFileSync(pathTxt, 'utf8').trim() : 'Electron.app/Contents/MacOS/Electron'
  process.env.ELECTRON_EXEC_PATH = join(dist, relative)
} else if (have && have !== want) {
  console.warn(`Electron package is ${have}; this host expects ${want}. Run bun install in apps/desktop.`)
  ensurePackageBinary()
} else {
  rmSync(overrideRoot, { recursive: true, force: true })
  ensurePackageBinary()
}
