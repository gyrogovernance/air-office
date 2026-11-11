import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { vaultDelete, vaultExists, vaultRead, vaultWrite } from './credentials-vault.adapter'

type BridgeRequest = {
  action: string
  service: string
  account: string
  secret?: string
}

let server: Server | undefined
let token = ''
let port = 0
let profile: 'Data' | 'Demo' = 'Data'

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 65_536) {
        reject(new Error('Payload too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response: ServerResponse, code: number, secret?: string): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ code, ...(secret === undefined ? {} : { secret }) }))
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
    response.statusCode = 403
    response.end()
    return
  }
  if (request.method !== 'POST' || request.url !== '/credential') {
    response.statusCode = 404
    response.end()
    return
  }
  if (request.headers['x-air-credentials-token'] !== token) {
    response.statusCode = 401
    response.end()
    return
  }
  try {
    const body = JSON.parse(await readBody(request)) as BridgeRequest
    const valid =
      typeof body.service === 'string'
      && body.service.startsWith('air-office/')
      && body.service.length <= 200
      && typeof body.account === 'string'
      && body.account.length > 0
      && body.account.length <= 512
      && ['read', 'exists', 'write', 'delete'].includes(body.action)
      && (body.action !== 'write' || (typeof body.secret === 'string' && body.secret.length > 0 && body.secret.length <= 2500))
    if (!valid) {
      send(response, 1)
      return
    }
    if (body.action === 'read') {
      const secret = vaultRead(body.service, body.account, profile)
      if (secret === null) send(response, 2)
      else send(response, 0, secret)
      return
    }
    if (body.action === 'exists') {
      send(response, vaultExists(body.service, body.account, profile) ? 0 : 2)
      return
    }
    if (body.action === 'write') {
      send(response, vaultWrite(body.service, body.account, body.secret ?? '', profile) ? 0 : 1)
      return
    }
    const removed = vaultDelete(body.service, body.account, profile)
    send(response, removed === 'absent' ? 2 : removed ? 0 : 1)
  } catch {
    send(response, 1)
  }
}

export async function startCredentialsBridge(activeProfile: 'Data' | 'Demo' = 'Data'): Promise<{ url: string; token: string }> {
  await stopCredentialsBridge()
  profile = activeProfile
  token = randomBytes(24).toString('hex')
  server = createServer((request, response) => {
    void handle(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Credentials bridge failed to bind.')
  port = address.port
  return { url: `http://127.0.0.1:${port}`, token }
}

export async function stopCredentialsBridge(): Promise<void> {
  const current = server
  server = undefined
  port = 0
  token = ''
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

export function credentialsBridgeEnv(): Record<string, string> {
  if (!port || !token) return {}
  return {
    OFFICE_CREDENTIALS_BRIDGE_URL: `http://127.0.0.1:${port}`,
    OFFICE_CREDENTIALS_BRIDGE_TOKEN: token,
  }
}
