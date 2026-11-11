import { contextBridge, ipcRenderer } from 'electron'

export type AirDesktopApi = {
  invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  versions: { electron: string; chrome: string; node: string }
}

const api: AirDesktopApi = {
  invoke: (command, ...args) => ipcRenderer.invoke('air:invoke', command, ...args),
  on: (channel, listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    if (channel === 'air-office-bootstrap') {
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    }
    return () => undefined
  },
  platform: process.platform,
  arch: process.arch,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}

contextBridge.exposeInMainWorld('airDesktop', api)
