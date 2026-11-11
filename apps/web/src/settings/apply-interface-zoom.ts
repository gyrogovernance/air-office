/** Apply Interface size. Desktop host: native zoom (liquid-glass-safe). Browser: CSS zoom on html. */

import { isDesktopHost, isElectronHost, setDesktopInterfaceZoom } from '../entry/desktop-host.adapter';

function isDesktopShell(): boolean {
  return typeof window !== 'undefined' && isDesktopHost();
}

function isWindowsShell(): boolean {
  return isDesktopShell() && /Windows/i.test(navigator.userAgent) && !isElectronHost();
}

function clearCssZoom(): void {
  document.documentElement.style.removeProperty('zoom');
  const root = document.getElementById('root');
  root?.style.removeProperty('zoom');
}

/** Keep frame caption controls at 1:1 with the native snap HWND when the webview is zoomed. */
function setWindowsCaptionZoomCompensate(scale: number): void {
  if (!isWindowsShell()) {
    document.documentElement.style.removeProperty('--air-frame-caption-zoom');
    return;
  }
  const inverse = scale === 1 ? 1 : 1 / scale;
  document.documentElement.style.setProperty('--air-frame-caption-zoom', String(inverse));
}

export async function applyNativeInterfaceZoom(scale: number): Promise<void> {
  if (!Number.isFinite(scale) || scale <= 0) return;

  if (isDesktopShell()) {
    clearCssZoom();
    document.documentElement.style.setProperty('--air-interface-zoom', String(scale));
    setWindowsCaptionZoomCompensate(scale);
    /*
     * Native webview zoom (not CSS zoom): CSS zoom on #root/#html breaks
     * liquid-glass measurement and backdrop sampling.
     */
    await setDesktopInterfaceZoom(scale);
    return;
  }

  /* Vite / browser: there is no webview zoom API, so CSS zoom is the preview. */
  document.documentElement.style.removeProperty('--air-frame-caption-zoom');
  document.documentElement.style.setProperty('--air-interface-zoom', String(scale));
  if (scale === 1) document.documentElement.style.removeProperty('zoom');
  else document.documentElement.style.zoom = String(scale);
}
