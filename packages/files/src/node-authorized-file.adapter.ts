import { FileOperationError, type FileAdapter, type FileSnapshot } from '@office/contracts/file';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';

export interface NodeFileAdapterOptions {
  /** Explicit directory that bounds every path the adapter will touch. */
  root: string;
  /** Maximum accepted file size in bytes. Defaults to 1 MiB. */
  maxBytes?: number;
  /** Extensions (with leading dot) that may be read or written. */
  extensions?: string[];
}

const defaultExtensions = ['.txt', '.md', '.json', '.ts', '.tsx', '.js', '.css', '.html', '.py', '.rs', '.toml'];
const defaultMaxBytes = 1_048_576;

const versionOf = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

/**
 * Files adapter for a real operating-system directory. Authorization is an explicit
 * root configured by the service, never a renderer-supplied absolute path. Every
 * identifier is resolved against the root and containment is re-checked after
 * resolving symlinks, so traversal and symlink escapes fail closed. Reads return a
 * content-hash version and writes require that exact version.
 */
export class NodeAuthorizedFileAdapter implements FileAdapter {
  private readonly root: string;
  private readonly maxBytes: number;
  private readonly extensions: string[];

  constructor(options: NodeFileAdapterOptions) {
    if (!options.root || !options.root.trim()) throw new FileOperationError('file-unauthorized', 'An authorized root directory is required.');
    this.root = resolve(options.root);
    this.maxBytes = options.maxBytes ?? defaultMaxBytes;
    this.extensions = (options.extensions ?? defaultExtensions).map((extension) => extension.toLowerCase());
  }

  async authorize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async restoreAuthorization(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /**
   * Resolves a request identifier inside the authorized root and returns the
   * canonical target path. Rejects names that escape containment either
   * lexically or through an existing symlinked ancestor.
   */
  private async resolveWithinRoot(id: string): Promise<string> {
    if (typeof id !== 'string' || !id || id.length > 400) throw new FileOperationError('file-invalid-name', 'Enter a valid file name.');
    if (id.includes('\0')) throw new FileOperationError('file-invalid-name', 'Enter a valid file name.');
    const relative = id.replaceAll('\\', '/');
    if (relative.startsWith('/') || /^[A-Za-z]:/.test(relative)) throw new FileOperationError('file-unauthorized', 'The requested path is outside the authorized workspace.');
    const segments = relative.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new FileOperationError('file-unauthorized', 'The requested path is outside the authorized workspace.');
    const target = resolve(this.root, ...segments);
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`)) throw new FileOperationError('file-unauthorized', 'The requested path is outside the authorized workspace.');
    await this.assertNoSymlinkEscape(target);
    return target;
  }

  /** Walks each existing ancestor and rejects any that resolves outside the root. */
  private async assertNoSymlinkEscape(target: string): Promise<void> {
    const rootReal = await realpath(this.root);
    let current = target;
    for (let depth = 0; depth <= 64; depth++) {
      try {
        const resolved = await realpath(current);
        if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${sep}`)) throw new FileOperationError('file-unauthorized', 'The requested path is outside the authorized workspace.');
        return;
      } catch (error) {
        if (error instanceof FileOperationError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw new FileOperationError('file-unauthorized', 'The requested path could not be verified.');
      }
      const parent = dirname(current);
      if (parent === current || current.length <= this.root.length) return;
      current = parent;
    }
    throw new FileOperationError('file-unauthorized', 'The requested path could not be verified.');
  }

  private assertExtension(target: string): string {
    const name = basename(target);
    const extension = name.includes('.') ? `.${name.split('.').at(-1)!.toLowerCase()}` : '';
    if (!this.extensions.includes(extension)) throw new FileOperationError('file-unsupported-type', 'That file type is not available in the authorized workspace.');
    return extension;
  }

  async list(): Promise<FileSnapshot[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const snapshots: FileSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = basename(entry.name).includes('.') ? `.${entry.name.split('.').at(-1)!.toLowerCase()}` : '';
      if (!this.extensions.includes(extension)) continue;
      const snapshot = await this.read(entry.name);
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  async create(name: string): Promise<FileSnapshot> {
    const target = await this.resolveWithinRoot(name);
    this.assertExtension(target);
    const existing = await lstat(target).catch(() => null);
    if (existing) throw new FileOperationError('file-invalid-name', 'A file with that name already exists.');
    const handle = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
    await handle.close();
    return { id: basename(target), name: basename(target), content: '', version: versionOf('') };
  }

  async read(id: string): Promise<FileSnapshot> {
    const target = await this.resolveWithinRoot(id);
    this.assertExtension(target);
    const entry = await lstat(target).catch(() => null);
    if (!entry) throw new FileOperationError('file-not-found', 'That file does not exist.');
    if (!entry.isFile()) throw new FileOperationError('file-not-found', 'That file does not exist.');
    if (entry.size > this.maxBytes) throw new FileOperationError('file-too-large', 'The file exceeds the authorized size limit.');
    const content = await readFile(target, 'utf8');
    return { id: basename(target), name: basename(target), content, version: versionOf(content) };
  }

  async save(id: string, content: string, expectedVersion: string): Promise<FileSnapshot> {
    const target = await this.resolveWithinRoot(id);
    this.assertExtension(target);
    if (typeof content !== 'string') throw new FileOperationError('file-invalid-name', 'Content must be text.');
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) throw new FileOperationError('file-too-large', 'The content exceeds the authorized size limit.');
    if (typeof expectedVersion !== 'string' || !expectedVersion) throw new FileOperationError('file-stale-version', 'A current file version is required to save.');
    const entry = await lstat(target).catch(() => null);
    if (!entry || !entry.isFile()) throw new FileOperationError('file-not-found', 'That file does not exist.');
    const current = await readFile(target, 'utf8');
    if (versionOf(current) !== expectedVersion) throw new FileOperationError('file-stale-version', 'The file changed externally. Reload it before saving.');
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o644 });
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return { id: basename(target), name: basename(target), content, version: versionOf(content) };
  }
}
