import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { prepareCodeAuth } from './code-auth.adapter'
import { startDemoService, stopDemoService, demoServiceStatus } from './demo-service.adapter'
import {
  activateLemonadeRuntime,
  lemonadeStatus,
  rollbackLemonadeRuntime,
  startLemonade,
  stopLemonade,
} from './lemonade.adapter'
import { ensureWindowsNetworkAccess } from './network-access.adapter'
import { publishBootstrap, restartDesktopServices, startService, stopService, serviceStatus } from './service.adapter'
import { revealMainWindow, setInterfaceZoom } from './window.adapter'

type IpcResult = unknown

const handlers: Record<string, (args: unknown[]) => Promise<IpcResult>> = {
  start_service: async () => startService(),
  stop_service: async (args) => stopService(typeof args[0] === 'number' ? args[0] : undefined),
  service_status: async () => serviceStatus(),
  start_lemonade: async () => startLemonade(),
  stop_lemonade: async (args) => {
    const generation = typeof args[0] === 'number' ? args[0] : Number(args[0])
    if (!Number.isFinite(generation)) throw new Error('A runtime generation is required.')
    await stopLemonade(generation)
  },
  lemonade_status: async () => {
    const status = await lemonadeStatus()
    return {
      kind: status.kind,
      generation: status.generation,
      base_origin: status.baseOrigin,
      release: status.release,
      state: status.state,
    }
  },
  publish_bootstrap: async () => publishBootstrap(),
  restart_desktop_services: async (args) => {
    const generation = typeof args[0] === 'number' ? args[0] : undefined
    return restartDesktopServices(generation)
  },
  start_demo_service: async () => startDemoService(),
  stop_demo_service: async () => stopDemoService(),
  demo_service_status: async () => demoServiceStatus(),
  select_data_folder: async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Choose AIR Office data folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  },
  select_lemonade_model_folder: async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Choose Local AI model folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selected = result.filePaths[0]
    if (!selected) return null
    const label = selected.split(/[/\\]/).filter(Boolean).pop() ?? selected
    return { id: selected, label }
  },
  open_connector_sign_in: async (args) => {
    const raw = args[0]
    const url = typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'url' in raw
        ? String((raw as { url: unknown }).url)
        : ''
    if (!/^https:\/\//i.test(url)) throw new Error('Only HTTPS sign-in addresses are allowed.')
    await shell.openExternal(url)
  },
  ensure_windows_network_access: async () => ensureWindowsNetworkAccess(),
  activate_lemonade_runtime: async (args) => {
    const generation = typeof args[0] === 'number' ? args[0] : Number(args[0])
    await activateLemonadeRuntime(generation)
    return publishBootstrap()
  },
  rollback_lemonade_runtime: async (args) => {
    const generation = typeof args[0] === 'number' ? args[0] : Number(args[0])
    await rollbackLemonadeRuntime(generation)
    return publishBootstrap()
  },
  show_main_window: async () => {
    revealMainWindow()
  },
  set_interface_zoom: async (args) => {
    const factor = typeof args[0] === 'number' ? args[0] : Number(args[0])
    if (!Number.isFinite(factor)) throw new Error('Invalid zoom factor.')
    setInterfaceZoom(factor)
  },
  prepare_code_auth: async (args) => {
    const payload = (args[0] && typeof args[0] === 'object' ? args[0] : {}) as {
      href?: string
      token?: string | null
    }
    if (!payload.href || !payload.token) throw new Error('Code sign-in details are required.')
    return prepareCodeAuth({ href: payload.href, token: payload.token })
  },
}

export function registerIpcHandlers(): void {
  ipcMain.handle('air:invoke', async (_event, command: string, ...args: unknown[]) => {
    const handler = handlers[command]
    if (!handler) throw new Error(`Unknown desktop command: ${command}`)
    try {
      return await handler(args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[desktop] ${command} failed: ${message}`)
      throw error
    }
  })
}

export function emitBootstrap(payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('air-office-bootstrap', payload)
  }
}
