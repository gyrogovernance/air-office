import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { getLemonadeServiceEnv, startLemonade, stopLemonade } from './lemonade.adapter'

let server: Server | undefined
let token = ''
let port = 0

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

function authorized(request: IncomingMessage): boolean {
  return request.headers['x-air-host-token'] === token
}

async function publishHostBootstrap(): Promise<void> {
  try {
    const { publishBootstrap } = await import('./service.adapter')
    const { emitBootstrap } = await import('./ipc.adapter')
    emitBootstrap(await publishBootstrap())
  } catch {
    /* service may not be up yet */
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1' && request.socket.remoteAddress !== '::ffff:127.0.0.1') {
    response.statusCode = 403
    response.end()
    return
  }
  if (!authorized(request)) {
    response.statusCode = 401
    response.end()
    return
  }
  try {
    if (request.method === 'POST' && request.url === '/lemonade/start') {
      await startLemonade()
      const environment = getLemonadeServiceEnv()
      if (!environment) {
        sendJson(response, 503, { error: 'The local AI runtime did not return a usable address.' })
        return
      }
      await publishHostBootstrap()
      sendJson(response, 200, { environment })
      return
    }
    if (request.method === 'POST' && request.url === '/lemonade/stop') {
      await stopLemonade()
      await publishHostBootstrap()
      sendJson(response, 200, { ok: true })
      return
    }
    response.statusCode = 404
    response.end()
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Host control failed.' })
  }
}

export async function startHostControl(): Promise<{ url: string; token: string }> {
  await stopHostControl()
  token = randomBytes(24).toString('hex')
  server = createServer((request, response) => {
    void handle(request, response)
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Host control failed to bind.')
  port = address.port
  return { url: `http://127.0.0.1:${port}`, token }
}

export async function stopHostControl(): Promise<void> {
  const current = server
  server = undefined
  port = 0
  token = ''
  if (!current) return
  await new Promise<void>((resolve) => current.close(() => resolve()))
}

export function hostControlEnv(): Record<string, string> {
  if (!port || !token) return {}
  return {
    OFFICE_DEV_LAZY_LEMONADE: '1',
    OFFICE_HOST_CONTROL_URL: `http://127.0.0.1:${port}`,
    OFFICE_HOST_CONTROL_TOKEN: token,
  }
}
