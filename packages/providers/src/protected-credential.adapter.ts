import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ProtectedCredentialStore = {
  resolve(id: string): Promise<string | null>;
  store(id: string, secret: string): Promise<void>;
  forget(id: string): Promise<'removed' | 'absent' | 'failed'>;
  forgetAll(): Promise<{ removed: number; failed: string[] }>;
};

export type ProtectedCredentialStoreOptions = {
  /** Absolute directory under the service private root. Created on first use. */
  directory: string;
};

/**
 * Service-owned credential files for secrets that exceed OS keychain limits,
 * such as ChatGPT OAuth account records with access, refresh, and ID tokens.
 * Files stay under the private data root with owner-only mode where the OS
 * honors it. The renderer never receives these values.
 */
export function createProtectedCredentialStore(options: ProtectedCredentialStoreOptions): ProtectedCredentialStore {
  if (!options.directory || options.directory.includes('\0')) throw new Error('Protected credentials require a private directory.');
  const root = options.directory;
  const fileFor = (id: string) => {
    if (!id || id.length > 200 || /[\\/\0]/.test(id) || id.includes('..')) throw new Error('The credential id is invalid.');
    return join(root, `${Buffer.from(id).toString('base64url')}.cred`);
  };
  const ensureRoot = async () => { await mkdir(root, { recursive: true, mode: 0o700 }); };
  return {
    resolve: async (id) => {
      const target = fileFor(id);
      try {
        const value = await readFile(target, 'utf8');
        return value.length > 0 ? value : null;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
        throw new Error('The saved credential could not be read.');
      }
    },
    store: async (id, secret) => {
      if (typeof secret !== 'string' || !secret) throw new Error('The credential could not be stored.');
      const target = fileFor(id);
      await ensureRoot();
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, secret, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw new Error('The credential could not be stored.');
      }
    },
    forget: async (id) => {
      try {
        await rm(fileFor(id), { force: false });
        return 'removed';
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 'absent';
        return 'failed';
      }
    },
    forgetAll: async () => {
      try { await ensureRoot(); } catch { return { removed: 0, failed: ['*'] }; }
      const failed: string[] = [];
      let removed = 0;
      let names: string[] = [];
      try { names = await readdir(root); } catch { return { removed: 0, failed: ['*'] }; }
      for (const name of names) {
        if (!name.endsWith('.cred')) continue;
        try {
          await rm(join(root, name), { force: false });
          removed++;
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
          failed.push(name);
        }
      }
      return { removed, failed };
    }
  };
}
