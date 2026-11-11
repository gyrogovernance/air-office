/**
 * Asks the desktop host to register Windows Firewall allow-rules for the
 * bundled search helpers once, before a chat tool run can trip a mid-prompt.
 * No-op in the browser development shell.
 */

import { desktopInvoke, isDesktopHost } from '../entry/desktop-host.adapter';

export type WindowsNetworkAccessStatus = {
  prepared: boolean;
  elevated: boolean;
  programs: string[];
  detail: string;
};

export async function ensureWindowsNetworkAccess(): Promise<WindowsNetworkAccessStatus | null> {
  if (!isDesktopHost()) return null;
  return desktopInvoke<WindowsNetworkAccessStatus>('ensure_windows_network_access');
}
