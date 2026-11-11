export const desktopServiceOrigins = [
  'air-office://localhost',
];

/** Accept only the native desktop origins or an HTTP loopback origin with a port. */
export function trustedServiceOrigin(origin: string): string | null {
  if (desktopServiceOrigins.includes(origin)) return origin;
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(origin)) return null;
  const port = Number(origin.slice(origin.lastIndexOf(':') + 1));
  return port > 0 && port <= 65535 ? origin : null;
}

export function bootstrapRequestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin !== null) return trustedServiceOrigin(origin);
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.username || url.password) return null;
    const nativeOrigin = `${url.protocol}//${url.host}`;
    return desktopServiceOrigins.includes(nativeOrigin) ? nativeOrigin : null;
  } catch { return null; }
}
