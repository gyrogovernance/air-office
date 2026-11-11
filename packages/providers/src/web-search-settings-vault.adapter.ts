import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ensureVaultSettingsFiles,
  readWebSearchSettingsFile,
  webSearchCheckPath,
  writeWebSearchSettingsFile,
} from '../../vault/src/vault-settings.authority.public';
import { VAULT_PATHS } from '../../vault/src/vault.domain.public';
import { resolveUnderVault, resolveVaultRoot } from '../../vault/src/vault.host.public';
import type { WebSearchCheckRecord, WebSearchLoaderOptions, WebSearchSettingsStore } from './web-search-settings.service';

/**
 * Web search enablement, endpoint, and loader options in `.air/settings/web-search.yaml`.
 * Reachability check results stay under `.air/runtime` (not portable user config).
 */
export function createVaultWebSearchSettingsStore(vaultRoot: string, seedEndpoint?: string): WebSearchSettingsStore {
  const settingsFile = resolveUnderVault(resolveVaultRoot(vaultRoot), VAULT_PATHS.webSearchSettings);
  const firstCreate = !existsSync(settingsFile);
  ensureVaultSettingsFiles(vaultRoot);
  if (firstCreate && seedEndpoint?.trim() && /^https?:\/\//i.test(seedEndpoint) && seedEndpoint.length <= 2000) {
    const initial = readWebSearchSettingsFile(vaultRoot);
    writeWebSearchSettingsFile({ ...initial, endpoint: seedEndpoint.trim() }, vaultRoot);
  }
  const checkFile = webSearchCheckPath(vaultRoot);
  const readCheck = (): WebSearchCheckRecord | null => {
    if (!existsSync(checkFile)) return null;
    try {
      const parsed = JSON.parse(readFileSync(checkFile, 'utf8')) as WebSearchCheckRecord;
      return typeof parsed === 'object' && parsed !== null && typeof parsed.reachable === 'boolean' ? parsed : null;
    } catch {
      return null;
    }
  };
  return {
    read: () => {
      const settings = readWebSearchSettingsFile(vaultRoot);
      return {
        endpoint: settings.endpoint,
        enabled: settings.enabled,
        options: (settings.options ?? {}) as WebSearchLoaderOptions,
        lastCheck: readCheck(),
      };
    },
    write: (endpoint, options, enabled) => {
      const current = readWebSearchSettingsFile(vaultRoot);
      writeWebSearchSettingsFile({
        schema: 'air.web-search/1',
        enabled: enabled === undefined ? current.enabled : enabled,
        endpoint,
        options: { ...(options ?? current.options ?? {}) },
      }, vaultRoot);
    },
    writeCheck: (check) => {
      mkdirSync(dirname(checkFile), { recursive: true });
      if (!check) {
        if (existsSync(checkFile)) writeFileSync(checkFile, '', 'utf8');
        return;
      }
      writeFileSync(checkFile, `${JSON.stringify(check)}\n`, 'utf8');
    },
    close: () => undefined,
  };
}
