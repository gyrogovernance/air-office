import type { KeychainRunner } from './keychain-credentials.adapter';

/**
 * Talks to the Electron host credentials bridge over loopback HTTP.
 * Used when OFFICE_CREDENTIALS_BRIDGE_URL + OFFICE_CREDENTIALS_BRIDGE_TOKEN are set.
 */
export function createCredentialsBridgeRunner(
  url = process.env.OFFICE_CREDENTIALS_BRIDGE_URL,
  token = process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN,
): KeychainRunner & { close(): void } {
  const request = async (action: string, service: string, account: string, secret?: string) => {
    if (!url || !token) throw new Error('The credentials bridge is unavailable.')
    const response = await fetch(new URL('/credential', url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-air-credentials-token': token,
      },
      body: JSON.stringify({ action, service, account, ...(secret === undefined ? {} : { secret }) }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Native credential access failed.')
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('code' in value) || typeof (value as { code: unknown }).code !== 'number') {
      throw new Error('Native credential access failed.')
    }
    const code = (value as { code: number }).code
    const resultSecret = 'secret' in value && typeof (value as { secret: unknown }).secret === 'string'
      ? (value as { secret: string }).secret
      : undefined
    return { code, secret: resultSecret }
  }
  return {
    close: () => undefined,
    read: async (service, account) => {
      const result = await request('read', service, account)
      if (result.code === 2) return null
      if (result.code !== 0) throw new Error('The saved credential could not be read from the system keychain.')
      return result.secret ?? null
    },
    exists: async (service, account) => {
      try {
        const result = await request('exists', service, account)
        return result.code === 0 ? true : result.code === 2 ? false : 'unknown'
      } catch {
        return 'unknown'
      }
    },
    write: async (service, account, secret) => (await request('write', service, account, secret)).code === 0,
    forget: async (service, account) => {
      const result = await request('delete', service, account)
      return result.code === 2 ? 'absent' : result.code === 0
    },
  }
}
