import { join } from 'node:path';
import { createCredentialsBridgeRunner } from './credentials-bridge.adapter';
import { createNativeKeychainRunner } from './native-keychain.adapter';
import { createProtectedCredentialStore } from './protected-credential.adapter';
import type { CredentialStore, ProviderCredentials } from './provider-credentials.port';

/**
 * Runs one keychain command and returns its stdout. It is a narrow boundary so
 * the OS-specific program stays injectable and testable, and so no secret is ever
 * written to a log. Presence and deletion distinguish known absence from an
 * OS failure; errors never include command output. A secret reaches the command either as
 * standard input or as one argument, never inside a logged command string.
 */
export interface KeychainRunner {
  /** Returns the stored secret for the service/account pair, or null when absent. */
  read(service: string, account: string): Promise<string | null>;
  /** Reports whether an entry exists without revealing its secret. */
  exists(service: string, account: string): Promise<boolean | 'unknown'>;
  /** Stores or replaces the secret. Returns false when the keychain command failed. */
  write(service: string, account: string, secret: string): Promise<boolean>;
  /** Removes the entry; known absence is distinct from a failed command. */
  forget(service: string, account: string): Promise<boolean | 'absent'>;
}

export interface KeychainCredentialsOptions {
  runner: KeychainRunner;
  /** Keychain service name; the provider id is used as the account. */
  service?: string;
}

/**
 * Desktop credential adapter. It resolves a provider secret from the operating
 * system keychain on demand. The adapter holds no cached secret and never returns
 * one to the renderer; callers on the service side use it for the duration of a
 * run only.
 */
export function createKeychainCredentials(options: KeychainCredentialsOptions): ProviderCredentials {
  const service = options.service ?? 'air-office/provider';
  return {
    resolve: async (providerId: string) => {
      const value = await options.runner.read(service, providerId);
      return value && value.length > 0 ? value : null;
    }
  };
}

export interface CredentialStoreOptions {
  runner: KeychainRunner;
  /** Keychain service name; the provider id is used as the account. */
  service?: string;
  /** Reports presence outside the keychain, for example an environment-configured token that a keychain delete cannot remove. */
  additionalPresence?: (providerId: string) => Promise<boolean>;
  initialIdentifiers?: () => string[];
}

/**
 * Write side of the credential boundary. It stores, removes, and reports
 * presence of provider secrets in the operating system keychain and never
 * returns a stored value; a failed store surfaces as an error without the
 * secret in its message. Presence is cached for a few seconds so a settings
 * surface does not shell out per paint, and a store or forget updates the cache
 * immediately; an edit made outside AIR can lag by up to ten seconds.
 */
export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
  const service = options.service ?? 'air-office/provider';
  const presenceCache = new Map<string, { at: number; value: boolean }>();
  const TTL_MS = 10_000;
  const remember = (providerId: string, value: boolean) => presenceCache.set(providerId, { at: Date.now(), value });
  const identifiers = new Set<string>();
  const forgetOne = async (providerId: string) => {
    const removed = await options.runner.forget(service, providerId);
    if (!removed) { presenceCache.delete(providerId); return 'failed' as const; }
    remember(providerId, false);
    return removed === 'absent' ? 'absent' as const : 'removed' as const;
  };
  return {
    configured: async (providerId: string) => {
      if (await options.additionalPresence?.(providerId)) return true;
      const cached = presenceCache.get(providerId);
      if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
      const value = await options.runner.exists(service, providerId);
      if (value === 'unknown') throw new Error('Credential presence could not be checked in the system keychain.');
      remember(providerId, value);
      return value;
    },
    store: async (providerId: string, secret: string) => {
      if (!(await options.runner.write(service, providerId, secret))) throw new Error('The credential could not be stored in the system keychain.');
      identifiers.add(providerId);
      remember(providerId, true);
    },
    forget: forgetOne,
    forgetAll: async () => {
      const failed: string[] = [];
      let removed = 0;
      for (const providerId of new Set([...identifiers, ...(options.initialIdentifiers?.() ?? [])])) {
        const result = await forgetOne(providerId);
        if (result === 'failed') failed.push(providerId);
        else if (result === 'removed') removed++;
      }
      return { removed, failed };
    }
  };
}

export type KeychainRun = (command: string, args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

export type PlatformKeychainOptions = {
  /**
   * Private directory for a file-backed vault when the Electron credentials
   * bridge is not running (browser `bun run dev` on Windows/macOS). Desktop
   * packages always pass the bridge instead.
   */
  fileDirectory?: string;
};

/**
 * File-backed keychain used by browser development on Windows and macOS.
 * Secrets stay under the service private root; the renderer never receives them.
 */
export function createProtectedKeychainRunner(directory: string): KeychainRunner {
  const stores = new Map<string, ReturnType<typeof createProtectedCredentialStore>>();
  const storeFor = (service: string) => {
    let store = stores.get(service);
    if (!store) {
      store = createProtectedCredentialStore({ directory: join(directory, Buffer.from(service).toString('base64url')) });
      stores.set(service, store);
    }
    return store;
  };
  return {
    read: (service, account) => storeFor(service).resolve(account),
    exists: async (service, account) => (await storeFor(service).resolve(account)) !== null,
    write: async (service, account, secret) => {
      try {
        await storeFor(service).store(account, secret);
        return true;
      } catch {
        return false;
      }
    },
    forget: (service, account) => storeFor(service).forget(account),
  };
}

/** Prefer Electron credentials bridge; otherwise use secret-tool on Linux or an optional helper path. */
export function createPlatformKeychainRunner(platform: NodeJS.Platform = process.platform, run: KeychainRun, options?: PlatformKeychainOptions): KeychainRunner {
  if (process.env.OFFICE_CREDENTIALS_BRIDGE_URL && process.env.OFFICE_CREDENTIALS_BRIDGE_TOKEN) {
    return createCredentialsBridgeRunner();
  }
  if ((platform === 'win32' || platform === 'darwin') && process.env.OFFICE_NATIVE_CREDENTIALS) {
    return createNativeKeychainRunner(process.env.OFFICE_NATIVE_CREDENTIALS);
  }
  if ((platform === 'win32' || platform === 'darwin') && options?.fileDirectory) {
    return createProtectedKeychainRunner(options.fileDirectory);
  }
  if (platform === 'win32' || platform === 'darwin') {
    // Absent bridge and no private file vault: treat as empty so environment
    // credentials can still resolve. Writes stay unavailable until a vault is wired.
    return {
      read: async () => null,
      exists: async () => false,
      write: async () => false,
      forget: async () => false,
    };
  }
  return {
    read: async (service, account) => {
      const result = await run('secret-tool', ['lookup', 'service', service, 'account', account]);
      if (result.code !== 0) throw new Error('The saved credential could not be read from the system keychain.');
      return result.stdout.trim() || null;
    },
    exists: async (service, account) => {
      const result = await run('secret-tool', ['search', 'service', service, 'account', account]);
      return result.code === 0 ? true : 'unknown';
    },
    write: async (service, account, secret) => (await run('secret-tool', ['store', '--label', `${service}/${account}`, 'service', service, 'account', account], secret)).code === 0,
    forget: async (service, account) => (await run('secret-tool', ['clear', 'service', service, 'account', account])).code === 0
  };
}