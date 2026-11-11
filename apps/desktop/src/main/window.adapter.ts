import { BrowserWindow, app, nativeImage, screen, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const TITLEBAR_HEIGHT = 46
const BACKGROUND = '#0b0c0e'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * Resolve the branded AIR icon for window / Dock / taskbar.
 * Packaged builds ship icon.png (and icon.icns on macOS) under resources;
 * unpackaged electron-vite still runs stock Electron.app, so we load
 * apps/desktop/build/* explicitly (Forge/electron-builder icon path pattern).
 */
export function resolveAppIconPath(): string | undefined {
  const build = join(__dirname, '../../build')
  const appPath = app.getAppPath()
  const resources = process.resourcesPath ?? ''
  const candidates =
    process.platform === 'darwin'
      ? [
          join(resources, 'icon.icns'),
          join(resources, 'icon.png'),
          join(appPath, 'build', 'icon.icns'),
          join(appPath, 'build', 'icon.png'),
          join(build, 'icon.icns'),
          join(build, 'icon.png'),
        ]
      : process.platform === 'win32'
        ? [
            join(resources, 'icon.png'),
            join(resources, 'icon.ico'),
            join(appPath, 'build', 'icon.ico'),
            join(appPath, 'build', 'icon.png'),
            join(build, 'icon.ico'),
            join(build, 'icon.png'),
          ]
        : [
            join(resources, 'icon.png'),
            join(appPath, 'build', 'icon.png'),
            join(build, 'icon.png'),
          ]
  return candidates.find((path) => path && existsSync(path))
}

function loadAppIcon(): NativeImage | undefined {
  const path = resolveAppIconPath()
  if (!path) return undefined
  const icon = nativeImage.createFromPath(path)
  return icon.isEmpty() ? undefined : icon
}

/**
 * BrowserWindow `icon` covers Windows/Linux window chrome. On macOS the Dock
 * still shows Electron.app's atom for unpackaged `bun run dev -- --native`
 * unless dock.setIcon is called. Packaged .app already embeds icon.icns.
 */
export function applyBrandIcons(win?: BrowserWindow | null): void {
  const icon = loadAppIcon()
  if (!icon) return
  if (win && !win.isDestroyed()) win.setIcon(icon)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }
}

export function createMainWindow(preloadPath: string): BrowserWindow {
  const work = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1280, work.width)
  const height = Math.min(800, work.height)

  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'
  const icon = loadAppIcon()

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: 'AIR Office',
    ...(icon ? { icon } : {}),
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 18 } }
      : {}),
    ...(isWin
      ? {
          titleBarOverlay: {
            // Transparent strip so min/max/close sit on the app chrome.
            // Exact rgba(0,0,0,0) / #00000000 can fall back to an opaque system
            // frame color in Electron WCO; keep alpha 0 with a non-zero RGB.
            color: 'rgba(11, 12, 14, 0)',
            symbolColor: '#e8eaed',
            height: TITLEBAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      webgl: true,
    },
  })

  applyBrandIcons(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function revealMainWindow(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) win.show()
  win.focus()
}

export function setInterfaceZoom(factor: number): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const clamped = Math.min(3, Math.max(0.5, factor))
  win.webContents.setZoomFactor(clamped)
}

export function preloadPathFromOut(): string {
  const cjs = join(__dirname, '../preload/index.cjs')
  const mjs = join(__dirname, '../preload/index.mjs')
  const js = join(__dirname, '../preload/index.js')
  if (existsSync(cjs)) return cjs
  if (existsSync(mjs)) return mjs
  return js
}
