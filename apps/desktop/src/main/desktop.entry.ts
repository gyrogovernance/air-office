import { app, Menu } from 'electron'
import path from 'node:path'
import os from 'node:os'
import {
  attachAirOfficeProtocol,
  developmentAppUrl,
  registerAirOfficeScheme,
} from './protocol.adapter'
import { registerIpcHandlers, emitBootstrap } from './ipc.adapter'
import { startCredentialsBridge, stopCredentialsBridge } from './credentials-bridge.adapter'
import { startHostControl, stopHostControl } from './host-control.adapter'
import { configureCodeEmbedding } from './code-auth.adapter'
import { createMainWindow, preloadPathFromOut, revealMainWindow } from './window.adapter'
import { stopService } from './service.adapter'
import { stopLemonade } from './lemonade.adapter'
import { stopDemoService } from './demo-service.adapter'
import { publishBootstrap } from './service.adapter'
import { packagedUiAppUrl, startPackagedUiServer, stopPackagedUiServer } from './ui-server.adapter'

app.setName('AIR Office')
app.setAppUserModelId('org.airoffice.desktop')
// Stage iframe embeds loopback code-server; keep its session cookies usable.
app.commandLine.appendSwitch(
  'disable-features',
  'BlockThirdPartyCookies,ThirdPartyStoragePartitioning,LocalNetworkAccessChecks',
)
app.commandLine.appendSwitch('local-network-access-permissions-policy-default-enabled')
if (!app.isPackaged) {
  const support =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'AIR Office', 'Electron')
      : process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'AIR Office', 'Electron')
        : path.join(os.homedir(), '.local', 'share', 'AIR Office', 'Electron')
  app.setPath('userData', support)
}

registerAirOfficeScheme()

let quitting = false

async function shutdownChildren(): Promise<void> {
  try {
    await stopDemoService()
  } catch {
    /* ignore */
  }
  try {
    await stopLemonade()
  } catch {
    /* ignore */
  }
  try {
    await stopService()
  } catch {
    /* ignore */
  }
  await stopCredentialsBridge()
  await stopHostControl()
  try {
    await stopPackagedUiServer()
  } catch {
    /* ignore */
  }
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null)
  registerIpcHandlers()
  attachAirOfficeProtocol()
  configureCodeEmbedding()
  await startCredentialsBridge('Data')
  await startHostControl()

  const preload = preloadPathFromOut()
  console.info(`[desktop] preload=${preload}`)
  const win = createMainWindow(preload)
  const isDev = !app.isPackaged && !process.env.OFFICE_FORCE_PACKAGED_UI
  // Packaged: serve UI on 127.0.0.1 so Code's loopback iframe is not blocked.
  if (!isDev) await startPackagedUiServer()
  const url = isDev ? developmentAppUrl() : packagedUiAppUrl()
  console.info(`[desktop] loadURL=${url}`)
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl) => {
    console.error(`[desktop] did-fail-load ${code} ${desc} ${failedUrl}`)
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`)
  })
  await win.loadURL(url)

  win.once('ready-to-show', () => {
    revealMainWindow()
  })

  // If the renderer never asks to show, still reveal after a short delay.
  setTimeout(() => revealMainWindow(), 2500)
}

app.whenReady().then(() => {
  void boot().catch((error) => {
    console.error(error)
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void shutdownChildren().finally(() => {
    app.exit(0)
  })
})

app.on('activate', () => {
  if (process.platform === 'darwin') {
    revealMainWindow()
  }
})

export { emitBootstrap, publishBootstrap }
