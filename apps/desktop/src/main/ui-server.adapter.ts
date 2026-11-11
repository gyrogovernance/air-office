import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { desktopPackageRoot } from './paths.adapter'

/**
 * Packaged UI used to load from air-office:// (a secure custom scheme). Embedding
 * Code's http://127.0.0.1 workbench from that origin is blocked by Chromium
 * (mixed content / local-network), which leaves a blank white chrome-error iframe.
 * Serving the same files from loopback HTTP keeps parent and Code in the same
 * address space, matching `bun run dev` (Vite on 127.0.0.1).
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
}

const STATIC_ASSET = new Set(Object.keys(TYPES))

let server: Server | null = null
let baseUrl: string | null = null

function webDistRoot(): string {
  if (process.env.OFFICE_WEB_DIST && existsSync(process.env.OFFICE_WEB_DIST)) {
    return process.env.OFFICE_WEB_DIST
  }
  const packaged = join(process.resourcesPath, 'web')
  if (existsSync(join(packaged, 'index.html'))) return packaged
  const sibling = join(desktopPackageRoot(), '..', 'web', 'dist')
  if (existsSync(join(sibling, 'index.html'))) return sibling
  return join(desktopPackageRoot(), '..', 'web', 'dist')
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep
  return candidate === root || candidate.startsWith(normalizedRoot)
}

export async function startPackagedUiServer(): Promise<string> {
  if (baseUrl) return baseUrl
  const root = webDistRoot()
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`Packaged web UI missing at ${root}`)
  }

  server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url || '/', 'http://127.0.0.1')
      let pathname = decodeURIComponent(incoming.pathname)
      if (pathname === '/' || pathname === '') pathname = '/index.html'
      const filePath = normalize(join(root, pathname.replace(/^\//, '')))
      if (!isPathInsideRoot(root, filePath)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }
      let servePath = filePath
      if (!existsSync(servePath)) {
        if (STATIC_ASSET.has(extname(servePath).toLowerCase()) || pathname.startsWith('/arcade/')) {
          response.writeHead(404)
          response.end('Not Found')
          return
        }
        servePath = join(root, 'index.html')
      }
      const body = await readFile(servePath)
      const type = TYPES[extname(servePath).toLowerCase()] || 'application/octet-stream'
      response.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-cache',
      })
      response.end(body)
    } catch (error) {
      response.writeHead(500)
      response.end(error instanceof Error ? error.message : 'UI server error')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
  console.info(`[desktop] ui-server=${baseUrl} root=${root}`)
  return baseUrl
}

export function packagedUiAppUrl(): string {
  if (!baseUrl) throw new Error('Packaged UI server is not running.')
  return `${baseUrl}/index.html`
}

export async function stopPackagedUiServer(): Promise<void> {
  const active = server
  server = null
  baseUrl = null
  if (!active) return
  await new Promise<void>((resolve) => {
    active.close(() => resolve())
  })
}
