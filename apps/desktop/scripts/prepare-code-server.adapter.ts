import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractArchiveToFreshDirectory } from './artifact-archive.adapter';

const VERSION = '4.144.0';

type CodeServerPin = {
  triple: string;
  name: string;
  size: number;
  digest: string;
  url: string;
  executableRelative: string;
};

const PINS: readonly CodeServerPin[] = [
  {
    triple: 'x86_64-pc-windows-msvc',
    name: `code-server-${VERSION}-windows-amd64.tar.gz`,
    size: 211928944,
    digest: '324b7e31a2fb60c4e50202fdeae5e5cc5615878647973963874dea61d73ad9f7',
    url: `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-windows-amd64.tar.gz`,
    executableRelative: join('bin', 'code-server.cmd')
  },
  {
    triple: 'x86_64-unknown-linux-gnu',
    name: `code-server-${VERSION}-linux-amd64.tar.gz`,
    size: 231422956,
    digest: '710f749c40a0f3d0ab3be09c0de65314e5c2907cc50646f5fbc0f24c0e8fba2d',
    url: `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-linux-amd64.tar.gz`,
    executableRelative: join('bin', 'code-server')
  },
  {
    triple: 'aarch64-unknown-linux-gnu',
    name: `code-server-${VERSION}-linux-arm64.tar.gz`,
    size: 228563338,
    digest: '4404c784f541bd56a2a8d6e2a9474ed0b4e37bc8502aa3a247898ca933434482',
    url: `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-linux-arm64.tar.gz`,
    executableRelative: join('bin', 'code-server')
  },
  {
    triple: 'x86_64-apple-darwin',
    name: `code-server-${VERSION}-macos-amd64.tar.gz`,
    size: 228586897,
    digest: 'cb03ed6ce12136f9f9d6f32fd5d780b991d96cf0dd1b3d590c16d73accc665c9',
    url: `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-macos-amd64.tar.gz`,
    executableRelative: join('bin', 'code-server')
  },
  {
    triple: 'aarch64-apple-darwin',
    name: `code-server-${VERSION}-macos-arm64.tar.gz`,
    size: 209899249,
    digest: 'ebd78e944b9e918c0a1ca4239688c0e7a27096955dbf8ea98c3cad9668bc4fcc',
    url: `https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-macos-arm64.tar.gz`,
    executableRelative: join('bin', 'code-server')
  }
];

export function codeServerPinForTriple(targetTriple: string): CodeServerPin | null {
  return PINS.find((pin) => pin.triple === targetTriple) ?? null;
}

/** Stages the pinned VS Code workspace runtime for the desktop target triple. */
export async function prepareCodeServerResource(targetTriple: string, resourcesRoot: string, vendorRoot: string): Promise<boolean> {
  const pin = codeServerPinForTriple(targetTriple);
  if (!pin) return false;
  const destination = join(resourcesRoot, 'code-server');
  mkdirSync(vendorRoot, { recursive: true });
  const cachePath = join(vendorRoot, pin.name);
  let bytes: Buffer;
  if (existsSync(cachePath) && createHash('sha256').update(readFileSync(cachePath)).digest('hex') === pin.digest) bytes = readFileSync(cachePath);
  else {
    const response = await fetch(pin.url);
    if (!response.ok) throw new Error(`VS Code workspace download failed with HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== pin.size || createHash('sha256').update(bytes).digest('hex') !== pin.digest) throw new Error('VS Code workspace archive did not match the pinned digest.');
    writeFileSync(cachePath, bytes);
  }
  const tempRoot = join(resourcesRoot, '.code-server-download');
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });
  try {
    const archivePath = join(tempRoot, pin.name);
    writeFileSync(archivePath, bytes);
    const extracted = join(tempRoot, 'extracted');
    await extractArchiveToFreshDirectory(archivePath, extracted, 'tar.gz', { maxEntries: 200000, maxBytes: 1024 * 1024 ** 2, maxFileBytes: 512 * 1024 ** 2 });
    const roots = [extracted, ...readdirSync(extracted, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(extracted, entry.name))];
    const archiveRoot = roots.find((candidate) => existsSync(join(candidate, pin.executableRelative)));
    if (!archiveRoot) throw new Error('The VS Code workspace archive has no server executable.');
    rmSync(destination, { recursive: true, force: true });
    cpSync(archiveRoot, destination, { recursive: true });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  return true;
}
