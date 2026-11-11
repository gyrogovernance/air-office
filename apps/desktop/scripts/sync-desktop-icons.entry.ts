/**
 * Rebuild apps/desktop/build icon artifacts from assets/air_Icon-*.png.
 * Windows uses a multi-size .ico; macOS packaging uses .icns; .png is the
 * largest square source electron-builder and BrowserWindow can share.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const repoRoot = join(desktopRoot, '../..');
const assetsRoot = join(repoRoot, 'assets');
const buildRoot = join(desktopRoot, 'build');

const sizes = [32, 64, 128, 256, 512, 1024] as const;

function iconPath(size: (typeof sizes)[number]): string {
  return join(assetsRoot, `air_Icon-${size}.png`);
}

function assertSources(): void {
  for (const size of sizes) {
    const path = iconPath(size);
    if (!existsSync(path)) throw new Error(`Missing desktop icon source: ${path}`);
  }
}

/** Write a Windows ICO that embeds PNG payloads (Vista+ format). */
function writePngIco(pngFiles: ReadonlyArray<{ width: number; height: number; bytes: Uint8Array }>): Uint8Array {
  const count = pngFiles.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries: Array<{ width: number; height: number; bytes: Uint8Array; offset: number }> = [];
  for (const file of pngFiles) {
    entries.push({ ...file, offset });
    offset += file.bytes.byteLength;
  }
  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, count, true);
  entries.forEach((entry, index) => {
    const base = 6 + index * 16;
    out[base] = entry.width >= 256 ? 0 : entry.width;
    out[base + 1] = entry.height >= 256 ? 0 : entry.height;
    out[base + 2] = 0;
    out[base + 3] = 0;
    view.setUint16(base + 4, 1, true);
    view.setUint16(base + 6, 32, true);
    view.setUint32(base + 8, entry.bytes.byteLength, true);
    view.setUint32(base + 12, entry.offset, true);
    out.set(entry.bytes, entry.offset);
  });
  return out;
}

function syncPngAndIco(): void {
  mkdirSync(buildRoot, { recursive: true });
  copyFileSync(iconPath(1024), join(buildRoot, 'icon.png'));
  // Taskbar / Explorer use the smaller members; keep 512 as the largest ICO frame.
  const icoMembers = ([32, 64, 128, 256, 512] as const).map((size) => ({
    width: size,
    height: size,
    bytes: new Uint8Array(readFileSync(iconPath(size))),
  }));
  writeFileSync(join(buildRoot, 'icon.ico'), writePngIco(icoMembers));
}

function syncIcns(): void {
  const outfile = join(buildRoot, 'icon.icns');
  const source = iconPath(1024);
  // png2icons appends the format suffix to the output basename.
  const stagedBase = join(buildRoot, 'icon-mac');
  const staged = `${stagedBase}.icns`;
  const result = spawnSync(
    'bunx',
    ['--bun', 'png2icons', source, stagedBase, '-icns'],
    { cwd: repoRoot, encoding: 'utf8', shell: true },
  );
  if (result.status !== 0 || !existsSync(staged)) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (!existsSync(outfile)) {
      throw new Error(`Failed to build icon.icns.${detail ? `\n${detail}` : ''}`);
    }
    console.warn(`[desktop-icons] png2icons failed; kept existing icon.icns.${detail ? ` ${detail}` : ''}`);
    return;
  }
  copyFileSync(staged, outfile);
  try {
    unlinkSync(staged);
  } catch {
    /* leftover staging file is harmless */
  }
}

assertSources();
syncPngAndIco();
syncIcns();
console.log(`[desktop-icons] synced icon.png, icon.ico, icon.icns from assets/air_Icon-*.png`);
