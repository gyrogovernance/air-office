import type { NativeBootstrap } from './desktop-window.types';

type AirDesktopApi = {
  invoke: <T = unknown>(command: string, ...args: unknown[]) => Promise<T>
  on: (channel: string, listener: (payload: unknown) => void) => () => void
  platform: string
  arch?: string
  versions: { electron: string; chrome: string; node: string }
}

function airDesktopApi(win: Window = window): AirDesktopApi | undefined {
  return (win as Window & { airDesktop?: AirDesktopApi }).airDesktop
}

export function isDesktopHost(win: Window = window): boolean {
  return Boolean(airDesktopApi(win))
}

export function isElectronHost(win: Window = window): boolean {
  return Boolean(airDesktopApi(win))
}

/** Intel Mac desktop host (x64). Apple Silicon reports arm64. */
export function isIntelMacDesktopHost(win?: Window): boolean {
  if (typeof window === 'undefined' && win === undefined) return false
  const api = airDesktopApi(win ?? window)
  return Boolean(api && api.platform === 'darwin' && api.arch === 'x64')
}

export async function desktopInvoke<T = unknown>(command: string, ...args: unknown[]): Promise<T> {
  const api = airDesktopApi()
  if (!api) throw new Error('The desktop host is unavailable.')
  return api.invoke<T>(command, ...args)
}

export async function listenDesktopBootstrap(handler: (payload: NativeBootstrap) => void): Promise<() => void> {
  const api = airDesktopApi()
  if (!api) return () => undefined
  return api.on('air-office-bootstrap', (payload) => {
    handler(payload as NativeBootstrap)
  })
}

export async function revealDesktopWindow(): Promise<void> {
  const api = airDesktopApi()
  if (!api) return
  await api.invoke('show_main_window')
}

export async function setDesktopInterfaceZoom(scale: number): Promise<void> {
  const api = airDesktopApi()
  if (!api) return
  await api.invoke('set_interface_zoom', scale)
}
