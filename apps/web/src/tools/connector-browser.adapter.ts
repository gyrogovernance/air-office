import { desktopInvoke, isDesktopHost } from '../entry/desktop-host.adapter';

/** Open provider consent in the system browser on desktop, or a reserved window in browser development. */
export async function openConnectorSignIn(url: string, reservedWindow?: Window | null): Promise<void> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('The sign-in address must use HTTPS without embedded credentials.');
  if (isDesktopHost()) {
    await desktopInvoke('open_connector_sign_in', target.href);
    reservedWindow?.close();
    return;
  }
  if (reservedWindow && !reservedWindow.closed) { reservedWindow.opener = null; reservedWindow.location.href = target.href; return; }
  const opened = window.open('about:blank', '_blank');
  if (!opened) throw new Error('Allow browser pop-ups, then try signing in again.');
  opened.opener = null;
  opened.location.href = target.href;
}
