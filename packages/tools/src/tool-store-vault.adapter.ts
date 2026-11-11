import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import {
  ensureVaultSettingsFiles,
  readToolsSettingsFile,
  writeToolsSettingsFile,
} from '../../vault/src/vault-settings.authority.public';
import type { ToolsSettings } from '../../vault/src/settings.codec.public';
import type { ToolStore } from './tool-store.port';
import { createSqliteToolStore } from './tool-store.adapter';

function projectToolsYaml(store: ToolStore): ToolsSettings {
  return {
    schema: 'air.tools/1',
    connections: store.connections().map((connection) => ({
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      endpoint: connection.endpoint ?? null,
      enabled: connection.enabled !== false,
      ...(connection.local ? { local: connection.local } : {}),
    })),
    definitions: store.definitions().map((definition) => ({
      id: definition.id,
      connectionId: definition.connectionId,
      name: definition.name,
      enabled: definition.enabled !== false,
    })),
  };
}

function applyToolsYaml(store: ToolStore, settings: ToolsSettings): void {
  const connections = new Map(store.connections().map((item) => [item.id, item]));
  for (const row of settings.connections) {
    const existing = connections.get(row.id);
    if (!existing) continue;
    store.saveConnection({ ...existing, name: row.name, enabled: row.enabled, endpoint: row.endpoint });
  }
  const definitions = new Map(store.definitions().map((item) => [item.id, item]));
  for (const row of settings.definitions) {
    const existing = definitions.get(row.id);
    if (!existing) continue;
    store.saveDefinition({ ...existing, name: row.name, enabled: row.enabled });
  }
}

/**
 * SQLite keeps connection secrets and full definition schemas. Vault `tools.yaml`
 * is authority for portable enablement / names / endpoints mirrored on every write.
 */
export function createVaultBackedToolStore(options: { sqlitePath: string; vaultRoot: string }): ToolStore {
  ensureVaultSettingsFiles(options.vaultRoot);
  const inner = createSqliteToolStore(options.sqlitePath);
  const yaml = readToolsSettingsFile(options.vaultRoot);
  if (yaml.connections.length || yaml.definitions.length) applyToolsYaml(inner, yaml);
  else writeToolsSettingsFile(projectToolsYaml(inner), options.vaultRoot);

  const persist = () => writeToolsSettingsFile(projectToolsYaml(inner), options.vaultRoot);
  return {
    connections: () => inner.connections(),
    definitions: (connectionId) => inner.definitions(connectionId),
    saveConnection: (connection: ToolConnection) => {
      inner.saveConnection(connection);
      persist();
    },
    saveDefinition: (definition: ToolDefinition) => {
      inner.saveDefinition(definition);
      persist();
    },
    removeDefinition: (toolId) => {
      inner.removeDefinition?.(toolId);
      persist();
    },
    removeConnection: (connectionId) => {
      inner.removeConnection?.(connectionId);
      persist();
    },
    clearPersonalData: () => {
      inner.clearPersonalData();
      persist();
    },
    close: () => inner.close(),
  };
}
