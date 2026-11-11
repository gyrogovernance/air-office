/**
 * Electron host version by packaging target / local host.
 *
 * Chromium 152+ (Electron 44+) drops the macOS OpenGL ANGLE path and is
 * Metal-only. On Intel Iris that Metal init fails, WebGPU returns no adapter,
 * and liquid-glass cannot paint. Apple Silicon and Windows keep the newer host.
 */

export const ELECTRON_DEFAULT = '45.2.3'
export const ELECTRON_MAC_INTEL = '43.8.4'

export type ElectronTarget = 'host' | 'mac:intel' | 'mac:arm' | 'win' | 'default'

export function resolveElectronVersion(target: ElectronTarget = 'host'): string {
  if (target === 'mac:intel') return ELECTRON_MAC_INTEL
  if (target === 'mac:arm' || target === 'win' || target === 'default') return ELECTRON_DEFAULT
  if (process.platform === 'darwin' && process.arch === 'x64') return ELECTRON_MAC_INTEL
  return ELECTRON_DEFAULT
}

export function isMacIntelHost(): boolean {
  return process.platform === 'darwin' && process.arch === 'x64'
}
