import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractArchive, extractArchiveToFreshDirectory } from '../../../../apps/desktop/scripts/artifact-archive.adapter';
import { writeStoredZip } from '../../../support/stored-zip.adapter';

async function writeGzipTar(path: string, entries: { name: string; body?: Uint8Array; symlink?: string; mode?: number }[]): Promise<void> {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const entry of entries) {
    const header = new Uint8Array(512);
    const nameBytes = encoder.encode(entry.name);
    header.set(nameBytes.slice(0, 100), 0);
    const mode = entry.mode ?? 0o644;
    header.set(encoder.encode(mode.toString(8).padStart(7, '0')), 100);
    header.set(encoder.encode('0'.padStart(7, '0')), 108);
    header.set(encoder.encode('0'.padStart(7, '0')), 116);
    const size = entry.symlink ? 0 : (entry.body?.length ?? 0);
    header.set(encoder.encode(size.toString(8).padStart(11, '0')), 124);
    header.set(encoder.encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')), 136);
    header[156] = entry.symlink ? 0x32 : 0x30;
    if (entry.symlink) header.set(encoder.encode(entry.symlink).slice(0, 100), 157);
    header.set(encoder.encode('ustar\0'), 257);
    header.set(encoder.encode('00'), 263);
    let checksum = 0;
    for (let i = 0; i < header.length; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
    header.set(encoder.encode(checksum.toString(8).padStart(6, '0') + '\0 '), 148);
    blocks.push(header);
    if (entry.body && entry.body.length > 0) {
      blocks.push(entry.body);
      const pad = (512 - (entry.body.length % 512)) % 512;
      if (pad) blocks.push(new Uint8Array(pad));
    }
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  await writeFile(path, Bun.gzipSync(tar));
}

describe('desktop artifact archive safety', () => {
  test('rejects traversal paths without writing outside the destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-artifact-archive-'));
    const archive = join(root, 'unsafe.zip');
    try {
      await writeStoredZip(archive, { '../escape.txt': 'bad' });
      await expect(extractArchive(archive, join(root, 'destination'), 'zip')).rejects.toThrow(/relative path|escapes the destination/);
      expect(await Bun.file(join(root, 'escape.txt')).exists()).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('TAR preflight accepts files, allows in-tree relative symlinks, refuses escapes and quota expansion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-artifact-tar-'));
    try {
      const good = join(root, 'good.tar.gz'); const linked = join(root, 'linked.tar.gz'); const safeLink = join(root, 'safe-link.tar.gz');
      await writeGzipTar(good, [{ name: 'bin/server', body: new TextEncoder().encode('abc'), mode: 0o755 }]);
      await writeGzipTar(linked, [{ name: 'link', symlink: '../outside' }]);
      await writeGzipTar(safeLink, [
        { name: 'pkg/bin.js', body: new TextEncoder().encode('ok'), mode: 0o755 },
        { name: 'pkg/.bin/tool', symlink: '../bin.js' }
      ]);
      await extractArchive(good, join(root, 'good'), 'tar.gz');
      expect(await readFile(join(root, 'good', 'bin', 'server'), 'utf8')).toBe('abc');
      await expect(extractArchive(linked, join(root, 'linked'), 'tar.gz')).rejects.toThrow('links');
      await extractArchive(safeLink, join(root, 'safe'), 'tar.gz');
      expect(await readFile(join(root, 'safe', 'pkg', '.bin', 'tool'), 'utf8')).toBe('ok');
      await expect(extractArchive(good, join(root, 'quota'), 'tar.gz', { maxBytes: 2 })).rejects.toThrow('quota');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('ZIP collisions and quotas fail before writes; publication preserves existing content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-artifact-collision-'));
    try {
      const archive = join(root, 'collision.zip');
      await writeStoredZip(archive, { 'Name.txt': 'a', 'name.txt': 'b' });
      await expect(extractArchive(archive, join(root, 'collision'), 'zip')).rejects.toThrow('collision');
      expect(await Bun.file(join(root, 'collision', 'Name.txt')).exists()).toBe(false);
      await expect(extractArchive(archive, join(root, 'quota'), 'zip', { maxEntries: 1 })).rejects.toThrow('quota');
      const destination = join(root, 'existing'); await mkdir(destination); await writeFile(join(destination, 'keep.txt'), 'keep');
      await expect(extractArchiveToFreshDirectory(archive, destination, 'zip')).rejects.toThrow('fresh destination');
      expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('keep');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test('fresh ZIP publication retains content and removes staging directories after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'air-artifact-publish-'));
    try {
      const archive = join(root, 'good.zip');
      await writeStoredZip(archive, { 'lemonade/server.exe': 'fixture' });
      await extractArchiveToFreshDirectory(archive, join(root, 'published'), 'zip');
      expect(await readFile(join(root, 'published', 'lemonade', 'server.exe'), 'utf8')).toBe('fixture');
      await expect(extractArchiveToFreshDirectory(archive, join(root, 'limited'), 'zip', { maxFileBytes: 1 })).rejects.toThrow('quota');
      expect(await Bun.file(join(root, 'limited', 'lemonade', 'server.exe')).exists()).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
