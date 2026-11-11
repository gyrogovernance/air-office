import { session, type Session } from 'electron'

/**
 * Code stays in the stage iframe on http://127.0.0.1. Packaged UI is
 * air-office:// (secure), so Chromium may gate loopback embeds behind Local
 * Network Access / mixed-content rules. Allow those permissions and keep
 * response headers embeddable. Password cookie handoff remains for hosts that
 * still start code-server with auth=password.
 */
export function configureCodeEmbedding(target: Session = session.defaultSession): void {
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    if (
      permission === 'local-network-access'
      || permission === 'local-network'
      || permission === 'loopback-network'
      || permission === 'clipboard-read'
      || permission === 'clipboard-sanitized-write'
    ) {
      callback(true)
      return
    }
    callback(false)
  })

  target.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1:*/*'] }, (details, callback) => {
    const headers: Record<string, string[]> = {}
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      headers[name] = Array.isArray(value) ? value.map(String) : [String(value)]
    }
    const cookieKey = Object.keys(headers).find((name) => name.toLowerCase() === 'set-cookie')
    if (cookieKey) {
      headers[cookieKey] = headers[cookieKey]!.map((cookie) => {
        let next = cookie.replace(/;\s*SameSite=[^;]*/gi, '')
        if (!/;\s*Secure/i.test(next)) next += '; Secure'
        return `${next}; SameSite=None`
      })
    }
    const cspKey = Object.keys(headers).find((name) => name.toLowerCase() === 'content-security-policy')
    if (cspKey) {
      headers[cspKey] = headers[cspKey]!.map((policy) => {
        if (/frame-ancestors/i.test(policy)) {
          return policy.replace(/frame-ancestors[^;]*/gi, 'frame-ancestors *')
        }
        return `${policy}; frame-ancestors *`
      })
    }
    callback({ cancel: false, responseHeaders: headers })
  })
}

function isRedirectCancelled(error: unknown): boolean {
  return error instanceof Error && /redirect was cancelled/i.test(error.message)
}

/** True when the session already holds a code-server login cookie for this origin. */
async function sessionHasCodeCookie(origin: string): Promise<boolean> {
  const cookies = await session.defaultSession.cookies.get({ url: origin })
  return cookies.some((cookie) => cookie.name === 'code-server-session' && Boolean(cookie.value))
}

export async function prepareCodeAuth(options: {
  href: string
  token: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const url = new URL(options.href)
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') {
      return { ok: false, error: 'Code only opens on the local workbench.' }
    }
    const nextPath = `${url.pathname}${url.search}${url.hash}` || '/'
    const login = new URL('/login', url.origin)
    login.searchParams.set('to', nextPath)
    const requestInit: RequestInit & { redirect: RequestRedirect } = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: options.token }).toString(),
      // Prefer an explicit 302. Electron's session.fetch still throws
      // "Redirect was cancelled" on some hosts even with redirect:manual; the
      // Set-Cookie is applied before that throw, so we treat it as success.
      redirect: 'manual',
    }
    try {
      const response = await session.defaultSession.fetch(login.toString(), requestInit)
      if (response.status === 302 || response.status === 303 || response.status === 200) {
        return { ok: true }
      }
      if (await sessionHasCodeCookie(url.origin)) return { ok: true }
      return { ok: false, error: `Code sign-in failed (${response.status}).` }
    } catch (error) {
      if (isRedirectCancelled(error) && (await sessionHasCodeCookie(url.origin))) {
        return { ok: true }
      }
      if (isRedirectCancelled(error)) {
        // Cookie may still be mid-write; one short probe of the workbench URL.
        try {
          const probe = await session.defaultSession.fetch(options.href, { redirect: 'manual' })
          if (probe.status === 200 || probe.status === 302 || probe.status === 303) return { ok: true }
        } catch (probeError) {
          if (isRedirectCancelled(probeError) || (await sessionHasCodeCookie(url.origin))) return { ok: true }
        }
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Code sign-in failed.',
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Code sign-in failed.',
    }
  }
}
