import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync } from 'node:fs';
import { cp, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { FileSnapshot } from '@office/contracts/file';
import { FilesystemExplorerError, type ConnectedRoot, type FilesystemEntry, type FilesystemTarget, type TrashedEntry } from './filesystem-explorer.domain.public';

export interface FilesystemExplorer {
  roots(): ConnectedRoot[];
  connect(input: { path: string; name?: string }): Promise<ConnectedRoot>;
  disconnect(rootId: string): void;
  list(target: FilesystemTarget): Promise<FilesystemEntry[]>;
  read(target: FilesystemTarget): Promise<FileSnapshot>;
  save(input: FilesystemTarget & { content: string; expectedVersion: string }): Promise<FileSnapshot>;
  create(input: { rootId: string; parentPath: string; name: string; kind: 'file' | 'directory' }): Promise<FilesystemEntry>;
  transfer(input: FilesystemTarget & { destinationRootId?: string; destinationPath: string; operation: 'move' | 'copy' }): Promise<FilesystemEntry>;
  trash(target: FilesystemTarget): Promise<TrashedEntry>;
  trashEntries(rootId: string): TrashedEntry[];
  clearPersonalData(): void;
  restore(trashId: string): Promise<FilesystemEntry>;
  download(target: FilesystemTarget): Promise<{ name: string; bytes: Uint8Array }>;
  upload(input: { rootId: string; parentPath: string; name: string; bytes: Uint8Array }): Promise<FilesystemEntry>;
  close(): void;
}

const trashName = '.air-office-trash';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
const fail = (code: ConstructorParameters<typeof FilesystemExplorerError>[0], message: string): never => { throw new FilesystemExplorerError(code, message); };
const validName = (name: string): boolean => Boolean(name && name.length <= 255 && name !== '.' && name !== '..' && name.toLowerCase() !== trashName && !/[\\/:*?"<>|\u0000-\u001f]/.test(name) && !/[ .]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name));
const childPath = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
const contained = (root: string, target: string): boolean => { const path = relative(root, target); return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path)); };

export function createFilesystemExplorer(options: { databasePath: string; maxBytes?: number; maxTextBytes?: number; onAuthorizationRevoked?: () => void }): FilesystemExplorer {
  if (options.databasePath !== ':memory:') mkdirSync(dirname(options.databasePath), { recursive: true });
  const db = new Database(options.databasePath, { create: true });
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS file_roots (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, connectedAt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS file_trash (id TEXT PRIMARY KEY, rootId TEXT NOT NULL, originalPath TEXT NOT NULL, deletedAt TEXT NOT NULL);');
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const maxTextBytes = options.maxTextBytes ?? 2 * 1024 * 1024;
  // Serializing mutations closes application-level collision windows between existence checks and renames.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  };
  const rootFor = (id: string): ConnectedRoot => db.query<ConnectedRoot, [string]>('SELECT id,name,path,connectedAt FROM file_roots WHERE id=? AND active=1').get(id) ?? fail('not-found', 'This connected folder is unavailable.');
  const inspect = async (path: string) => lstat(path).catch((error: unknown) => { if (missing(error)) return null; throw error; });
  const resolveTarget = async (target: FilesystemTarget, allowRoot = false): Promise<string> => {
    const root = rootFor(target.rootId);
    const parts = target.path.replaceAll('\\', '/').split('/');
    if (target.path === '' && allowRoot) parts.length = 0;
    else if (!parts.length || parts.some((part) => !validName(part))) fail('unauthorized', 'The requested path is outside the connected folder or uses a reserved name.');
    const canonicalRoot = await realpath(root.path).catch(() => fail('not-found', 'The connected folder is no longer available.'));
    if (canonicalRoot !== root.path) fail('unauthorized', 'The connected folder location changed. Reconnect it before continuing.');
    let current = root.path;
    for (const part of parts) {
      current = resolve(current, part);
      if (!contained(root.path, current)) fail('unauthorized', 'The requested path is outside the connected folder.');
      const stat = await inspect(current);
      if (stat?.isSymbolicLink()) fail('unauthorized', 'Symbolic links cannot be followed by the file explorer.');
      if (stat && !contained(root.path, await realpath(current))) fail('unauthorized', 'The requested path leaves the connected folder.');
    }
    return current;
  };
  const entry = async (target: FilesystemTarget): Promise<FilesystemEntry> => {
    const path = await resolveTarget(target);
    const stat = await inspect(path) ?? fail('not-found', 'This file or folder no longer exists.');
    return { ...target, name: basename(path), kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other', size: stat.size, modifiedAt: stat.mtime.toISOString() };
  };
  const ensureAbsent = async (path: string): Promise<void> => { if (await inspect(path)) fail('conflict', 'A file or folder already exists at the destination.'); };
  const ensureDirectory = async (path: string): Promise<void> => { if (!(await inspect(path))?.isDirectory()) fail('not-found', 'The destination folder no longer exists.'); };
  const bytesFor = async (target: FilesystemTarget, limit: number): Promise<Uint8Array> => {
    const path = await resolveTarget(target);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch((error: unknown) => { if (missing(error)) fail('not-found', 'This file no longer exists.'); throw error; });
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) fail('unsupported', 'Only regular files can be opened.');
      if (stat.size > limit) fail('too-large', `This file exceeds the ${limit} byte limit.`);
      const bytes = await handle.readFile();
      if (bytes.byteLength > limit) fail('too-large', `This file exceeds the ${limit} byte limit.`);
      return bytes;
    } finally { await handle.close(); }
  };
  const decode = (bytes: Uint8Array): string => {
    if (bytes.includes(0)) fail('unsupported', 'This is a binary file. Download it or open it in a compatible application.');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { return fail('unsupported', 'This file is not UTF-8 text. Download it or open it in a compatible application.'); }
  };
  const read = async (target: FilesystemTarget): Promise<FileSnapshot> => { const bytes = await bytesFor(target, maxTextBytes); return { id: target.path, name: basename(target.path), content: decode(bytes), version: hash(bytes) }; };
  const upload = async (input: { rootId: string; parentPath: string; name: string; bytes: Uint8Array }): Promise<FilesystemEntry> => {
    if (!validName(input.name)) fail('invalid', 'Enter a valid file name.');
    if (input.bytes.byteLength > maxBytes) fail('too-large', `Uploads must be ${maxBytes} bytes or smaller.`);
    await ensureDirectory(await resolveTarget({ rootId: input.rootId, path: input.parentPath }, true));
    const target = { rootId: input.rootId, path: childPath(input.parentPath, input.name) };
    const path = await resolveTarget(target);
    await ensureAbsent(path);
    const handle = await open(path, 'wx').catch((error: unknown) => { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') fail('conflict', 'A file already exists at the destination.'); throw error; });
    try { await handle.writeFile(input.bytes); await handle.sync(); } catch (error) { await handle.close(); await rm(path, { force: true }); throw error; }
    await handle.close();
    return entry(target);
  };
  const inspectSubtree = async (path: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) fail('unsupported', 'This folder contains symbolic links or unsupported filesystem entries.');
    if (stat.isDirectory()) for (const child of await readdir(path)) {
      if (child.toLowerCase() === trashName) fail('unsupported', 'A folder containing explorer recovery storage cannot be moved or copied.');
      await inspectSubtree(resolve(path, child));
    }
  };
  const trashDirectory = async (root: ConnectedRoot): Promise<string> => {
    const path = resolve(root.path, trashName);
    const stat = await inspect(path);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail('unauthorized', 'The recovery folder is not a regular directory.');
    if (!stat) await mkdir(path, { mode: 0o700 });
    return path;
  };
  const trash = async (target: FilesystemTarget): Promise<TrashedEntry> => {
    const source = await resolveTarget(target);
    if (!(await inspect(source))) fail('not-found', 'This file or folder no longer exists.');
    const directory = await trashDirectory(rootFor(target.rootId));
    const item = { id: randomUUID(), rootId: target.rootId, originalPath: target.path, deletedAt: new Date().toISOString() };
    // Record first: a crash after the rename retains the path needed for recovery.
    db.query('INSERT INTO file_trash (id,rootId,originalPath,deletedAt) VALUES (?,?,?,?)').run(item.id, item.rootId, item.originalPath, item.deletedAt);
    try { await rename(source, resolve(directory, item.id)); }
    catch (error) { db.query('DELETE FROM file_trash WHERE id=?').run(item.id); throw error; }
    return item;
  };
  return {
    roots: () => db.query<ConnectedRoot, []>('SELECT id,name,path,connectedAt FROM file_roots WHERE active=1 ORDER BY connectedAt,id').all(),
    connect: (input) => mutate(async () => {
      if (!input.path?.trim() || !isAbsolute(input.path) || (input.name !== undefined && (!input.name.trim() || input.name.length > 255))) fail('invalid', 'Choose an existing absolute folder path and a valid name.');
      const path = await realpath(input.path).catch(() => fail('not-found', 'That folder does not exist.'));
      if (path.split(/[\\/]/).some((part) => part.toLowerCase() === trashName)) fail('unauthorized', 'Explorer recovery storage cannot be connected as a folder.');
      if (!(await lstat(path)).isDirectory()) fail('invalid', 'Choose a folder rather than a file.');
      const existing = db.query<ConnectedRoot, [string]>('SELECT id,name,path,connectedAt FROM file_roots WHERE path=?').get(path);
      if (existing) { db.query('UPDATE file_roots SET active=1 WHERE id=?').run(existing.id); return existing; }
      const root = { id: randomUUID(), path, name: input.name?.trim() ?? (basename(path) || path), connectedAt: new Date().toISOString() };
      db.query('INSERT INTO file_roots (id,name,path,connectedAt) VALUES (?,?,?,?)').run(root.id, root.name, root.path, root.connectedAt);
      return root;
    }),
    disconnect: (rootId) => { if (db.query('UPDATE file_roots SET active=0 WHERE id=? AND active=1').run(rootId).changes) options.onAuthorizationRevoked?.(); },
    list: async (target) => {
      const path = await resolveTarget(target, true);
      await ensureDirectory(path);
      const children = await readdir(path, { withFileTypes: true });
      const entries: FilesystemEntry[] = [];
      for (const child of children) {
        if (child.name.toLowerCase() === trashName) continue;
        const stat = await inspect(resolve(path, child.name));
        if (!stat) continue;
        entries.push({ rootId: target.rootId, path: childPath(target.path, child.name), name: child.name, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
      return entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    },
    read,
    save: (input) => mutate(async () => {
      const bytes = new TextEncoder().encode(input.content);
      if (bytes.byteLength > maxTextBytes) fail('too-large', `Text files must be ${maxTextBytes} bytes or smaller.`);
      const current = await read(input);
      if (!input.expectedVersion || current.version !== input.expectedVersion) fail('conflict', 'The file changed externally. Reload it before saving.');
      const path = await resolveTarget(input);
      const temporary = `${path}.${randomUUID()}.office-tmp`;
      const handle = await open(temporary, 'wx', (await lstat(path)).mode);
      try {
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        if (hash(await bytesFor(input, maxTextBytes)) !== input.expectedVersion) fail('conflict', 'The file changed externally. Reload it before saving.');
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
      return read(input);
    }),
    create: (input) => mutate(async () => {
      if (!validName(input.name)) fail('invalid', 'Enter a valid file or folder name.');
      if (input.kind === 'file') return upload({ ...input, bytes: new Uint8Array() });
      await ensureDirectory(await resolveTarget({ rootId: input.rootId, path: input.parentPath }, true));
      const target = { rootId: input.rootId, path: childPath(input.parentPath, input.name) };
      const path = await resolveTarget(target);
      await ensureAbsent(path); await mkdir(path);
      return entry(target);
    }),
    transfer: (input) => mutate(async () => {
      const source = await resolveTarget(input);
      const destinationTarget = { rootId: input.destinationRootId ?? input.rootId, path: input.destinationPath };
      const destination = await resolveTarget(destinationTarget);
      if (contained(source, destination)) fail('invalid', 'A folder cannot be moved or copied into itself.');
      await ensureDirectory(dirname(destination));
      await ensureAbsent(destination);
      if (!(await inspect(source))) fail('not-found', 'This file or folder no longer exists.');
      await inspectSubtree(source);
      if (input.operation === 'move' && destinationTarget.rootId === input.rootId) await rename(source, destination);
      else {
        const temporary = `${destination}.${randomUUID()}.office-copy`;
        try {
          await cp(source, temporary, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true });
          await inspectSubtree(temporary);
          await ensureAbsent(destination);
          await rename(temporary, destination);
        } finally { await rm(temporary, { recursive: true, force: true }); }
        if (input.operation === 'move') {
          try { await trash(input); }
          catch { fail('conflict', `The destination copy was saved at ${input.destinationPath}, but the source could not be moved to recovery storage. Both locations may contain the item. Refresh both folders before trying again.`); }
        }
      }
      return entry(destinationTarget);
    }),
    trash: (target) => mutate(() => trash(target)),
    trashEntries: (rootId) => { rootFor(rootId); return db.query<TrashedEntry, [string]>('SELECT * FROM file_trash WHERE rootId=? ORDER BY deletedAt DESC').all(rootId); },
    restore: (id) => mutate(async () => {
      const item = db.query<TrashedEntry, [string]>('SELECT * FROM file_trash WHERE id=?').get(id) ?? fail('not-found', 'This deleted item is unavailable.');
      const root = rootFor(item.rootId);
      const target = { rootId: item.rootId, path: item.originalPath };
      const path = await resolveTarget(target);
      await ensureAbsent(path); await ensureDirectory(dirname(path));
      const directory = await trashDirectory(root);
      const source = resolve(directory, item.id);
      const stat = await inspect(source);
      if (!stat || stat.isSymbolicLink()) fail('not-found', 'The deleted item is unavailable in recovery storage.');
      await rename(source, path);
      db.query('DELETE FROM file_trash WHERE id=?').run(id);
      return entry(target);
    }),
    download: async (target) => ({ name: basename(target.path), bytes: await bytesFor(target, maxBytes) }),
    upload: (input) => mutate(() => upload(input)),
    clearPersonalData: () => { db.transaction(() => { db.exec('DELETE FROM file_trash; DELETE FROM file_roots;'); })(); options.onAuthorizationRevoked?.(); },
    close: () => db.close()
  };
}
