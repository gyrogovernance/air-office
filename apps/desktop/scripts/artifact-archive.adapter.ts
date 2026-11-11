import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, mkdtemp, readdir, readlink, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract as extractTar, list as listTar } from 'tar';
import yauzl from 'yauzl';

export type ArchiveFormat = 'tar.gz' | 'zip';
export interface ExtractionLimits { maxEntries?: number; maxBytes?: number; maxFileBytes?: number; signal?: AbortSignal; }
export class ArchiveSafetyError extends Error {
  constructor(message: string) { super(message); this.name = 'ArchiveSafetyError'; }
}

function safeEntryPath(root: string, name: string): string {
  const normalized = name.replace(/^(\.\/)+/, '');
  if (name.length > 1024 || name.includes('\\') || /[\0<>:"|?*]/.test(normalized) || isAbsolute(normalized)) throw new ArchiveSafetyError('Archive entry is not a portable relative path.');
  const parts = normalized.replace(/\/$/, '').split('/');
  if (parts.length > 32) throw new ArchiveSafetyError('Archive path depth exceeds the extraction limit.');
  if (parts.some((part) => part === '..' || /[. ]$/.test(part) && part !== '.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw new ArchiveSafetyError('Archive entry escapes the destination or uses a reserved name.');
  const target = resolve(root, normalized);
  if (target !== root && !target.startsWith(root + sep)) throw new ArchiveSafetyError('Archive entry escapes the destination.');
  return target;
}

/** Relative symlinks that stay inside the extract root (e.g. node_modules/.bin) are allowed. */
function assertSafeRelativeSymlink(root: string, entryPath: string, linkpath: string): void {
  if (!linkpath || linkpath.length > 1024 || isAbsolute(linkpath) || linkpath.includes('\\') || linkpath.includes('\0')) {
    throw new ArchiveSafetyError('Archive links and special files are not permitted.');
  }
  const linkFile = safeEntryPath(root, entryPath);
  const resolved = resolve(dirname(linkFile), linkpath);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new ArchiveSafetyError('Archive links and special files are not permitted.');
  }
}

/** electron-builder resource packing rejects dangling/package symlinks; turn in-tree links into real files. */
async function materializeSymlinks(root: string, directory = root): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await materializeSymlinks(root, path);
    else if (entry.isSymbolicLink()) {
      const linkpath = await readlink(path);
      const resolved = resolve(directory, linkpath);
      if (resolved !== root && !resolved.startsWith(root + sep)) throw new ArchiveSafetyError('Archive links and special files are not permitted.');
      await unlink(path);
      await copyFile(resolved, path);
    }
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((done, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new ArchiveSafetyError('The ZIP archive could not be opened.')) : done(zip)));
}

/** Build-time extraction into a fresh tree, with bounded metadata preflight and streaming writes. */
export async function extractArchive(archivePath: string, destination: string, format: ArchiveFormat, limits: ExtractionLimits = {}): Promise<void> {
  const root = resolve(destination);
  const maxEntries = limits.maxEntries ?? 10_000;
  const maxBytes = limits.maxBytes ?? 8 * 1024 ** 3;
  const maxFileBytes = limits.maxFileBytes ?? 4 * 1024 ** 3;
  if (![maxEntries, maxBytes, maxFileBytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new ArchiveSafetyError('Invalid extraction limits.');
  if (await lstat(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; })) throw new ArchiveSafetyError('Archive extraction requires a fresh destination.');
  const paths = new Map<string, { path: string; directory: boolean; implicit: boolean; size: number }>();
  let entries = 0; let expanded = 0;
  const reserve = (name: string, directory: boolean, size: number) => {
    limits.signal?.throwIfAborted();
    if (++entries > maxEntries || !Number.isSafeInteger(size) || size < 0 || size > maxFileBytes || (expanded += size) > maxBytes) throw new ArchiveSafetyError('Archive extraction quota exceeded.');
    const target = safeEntryPath(root, name);
    if (target === root) { if (!directory) throw new ArchiveSafetyError('An archive file cannot replace its root.'); return; }
    const relative = target.slice(root.length + 1);
    const components = relative.split(sep);
    for (let index = 1; index < components.length; index++) {
      const parent = components.slice(0, index).join(sep); const key = parent.toLowerCase(); const known = paths.get(key);
      if (known && (!known.directory || known.path !== parent)) throw new ArchiveSafetyError('Archive path collision.');
      if (!known) { if (paths.size >= maxEntries) throw new ArchiveSafetyError('Archive extraction quota exceeded.'); paths.set(key, { path: parent, directory: true, implicit: true, size: 0 }); }
    }
    const key = relative.toLowerCase(); const known = paths.get(key);
    if (known && !(directory && known.directory && known.implicit && known.path === relative)) throw new ArchiveSafetyError('Archive path collision.');
    if (!known && paths.size >= maxEntries) throw new ArchiveSafetyError('Archive extraction quota exceeded.');
    paths.set(key, { path: relative, directory, implicit: false, size });
  };
  const expansionBound = () => {
    let count = 0;
    return new Transform({ transform(chunk: Buffer, _encoding, done) {
      count += chunk.byteLength;
      done(count > maxBytes + maxEntries * 2048 ? new ArchiveSafetyError('Expanded archive exceeds its byte budget.') : null, chunk);
    } });
  };
  if (format === 'tar.gz') {
    const parser = listTar({ strict: true, onReadEntry(entry) {
      try {
        const isSymlink = entry.type === 'SymbolicLink';
        if (!['File', 'OldFile', 'Directory', 'SymbolicLink'].includes(entry.type)) throw new ArchiveSafetyError('Archive links and special files are not permitted.');
        if (isSymlink) assertSafeRelativeSymlink(root, entry.path, entry.linkpath ?? '');
        reserve(entry.path, entry.type === 'Directory', isSymlink ? 0 : entry.size);
      } catch (error) { parser.abort(error as Error); }
      entry.resume();
    } });
    await pipeline(createReadStream(archivePath), createGunzip(), expansionBound(), parser, { signal: limits.signal });
    await mkdir(dirname(root), { recursive: true }); await mkdir(root);
    let changed = false;
    const extractor = extractTar({ cwd: root, strict: true, preservePaths: false, filter(name, entry) {
      if (!('type' in entry)) { changed = true; return false; }
      const target = safeEntryPath(root, name);
      if (target === root) return entry.type === 'Directory';
      const known = paths.get(target.slice(root.length + 1).toLowerCase());
      const isSymlink = entry.type === 'SymbolicLink';
      if (isSymlink) {
        try { assertSafeRelativeSymlink(root, name, 'linkpath' in entry ? String(entry.linkpath ?? '') : ''); }
        catch { changed = true; return false; }
      }
      const sizeMatches = isSymlink ? known?.size === 0 : known?.size === entry.size;
      const valid = known && sizeMatches && known.directory === (entry.type === 'Directory') && ['File', 'OldFile', 'Directory', 'SymbolicLink'].includes(entry.type);
      if (!valid) changed = true;
      return Boolean(valid);
    } });
    await pipeline(createReadStream(archivePath), createGunzip(), expansionBound(), extractor, { signal: limits.signal });
    if (changed) throw new ArchiveSafetyError('The archive changed after metadata validation.');
    await materializeSymlinks(root);
    return;
  }
  const zip = await openZip(archivePath);
  try {
    const members: yauzl.Entry[] = [];
    await new Promise<void>((done, reject) => {
      zip.on('entry', (entry) => {
        try {
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const type = mode & 0o170000;
          if (type !== 0 && type !== 0o100000 && !(type === 0o040000 && entry.fileName.endsWith('/')) || (entry.generalPurposeBitFlag & 1) !== 0) throw new ArchiveSafetyError('Archive links, special files and encrypted entries are not permitted.');
          reserve(entry.fileName, entry.fileName.endsWith('/'), entry.uncompressedSize);
          members.push(entry); zip.readEntry();
        } catch (error) { reject(error); }
      });
      zip.once('end', done); zip.once('error', reject); zip.readEntry();
    });
    await mkdir(dirname(root), { recursive: true }); await mkdir(root);
    for (const entry of members) {
      limits.signal?.throwIfAborted();
      const target = safeEntryPath(root, entry.fileName);
      if (entry.fileName.endsWith('/')) { await mkdir(target, { recursive: true }); continue; }
      await mkdir(dirname(target), { recursive: true });
      const stream = await new Promise<NodeJS.ReadableStream>((done, reject) => zip.openReadStream(entry, (error, input) => error || !input ? reject(error ?? new ArchiveSafetyError('Archive entry cannot be read.')) : done(input)));
      const executable = ((entry.externalFileAttributes >>> 16) & 0o111) !== 0;
      await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: executable ? 0o755 : 0o644 }), { signal: limits.signal });
    }
  } finally { zip.close(); }
}

export async function extractArchiveToFreshDirectory(archivePath: string, destination: string, format: ArchiveFormat, limits: ExtractionLimits = {}): Promise<void> {
  const target = resolve(destination); const parent = dirname(target);
  if (await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; })) throw new ArchiveSafetyError('Archive publication requires a fresh destination.');
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, '.air-extract-'));
  if (dirname(staging) !== parent || !basename(staging).startsWith('.air-extract-')) throw new ArchiveSafetyError('Extraction staging ownership could not be established.');
  try {
    const content = join(staging, 'content'); await extractArchive(archivePath, content, format, limits);
    // Windows often returns EPERM when renaming a freshly written directory tree
    // (Defender or another scanner still holds handles). Fall back to copy+remove.
    try {
      await rename(content, target);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EXDEV') throw error;
      await cp(content, target, { recursive: true, errorOnExist: true });
      await rm(content, { recursive: true, force: true });
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
