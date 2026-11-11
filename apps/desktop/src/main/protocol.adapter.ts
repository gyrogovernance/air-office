import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { extname, join, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { desktopPackageRoot } from './paths.adapter'

const SCHEME = 'air-office'

/** Static asset extensions must 404 when missing — never fall back to the SPA shell. */
const STATIC_ASSET = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.map',
  '.wasm',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.wav',
  '.ogg',
  '.txt',
  '.md',
])

export function registerAirOfficeScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

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

export function attachAirOfficeProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const root = webDistRoot()
    const filePath = join(root, pathname.replace(/^\//, ''))
    if (!isPathInsideRoot(root, filePath)) {
      return new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
    }
    if (!existsSync(filePath)) {
      // Arcade/game scripts must not receive the React shell as fake JS (white page).
      if (STATIC_ASSET.has(extname(filePath).toLowerCase()) || pathname.startsWith('/arcade/')) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' })
      }
      const fallback = join(root, 'index.html')
      return net.fetch(pathToFileURL(fallback).toString())
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export function productionAppUrl(): string {
  return `${SCHEME}://localhost/index.html`
}

export function developmentAppUrl(): string {
  return process.env.OFFICE_DEV_URL ?? 'http://127.0.0.1:5173'
}

export { SCHEME as AIR_OFFICE_SCHEME }
