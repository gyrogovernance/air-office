import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VAULT_PATHS } from './vault.domain.public';
import { resolveUnderVault, resolveVaultRoot } from './vault.host.public';
import {
  parseModelHarnessSettings,
  parseToolsSettings,
  parseWebSearchSettings,
  writeYamlSettings,
  type ModelHarnessSettings,
  type ToolsSettings,
  type WebSearchSettings,
} from './settings.codec.public';

export type { ModelHarnessSettings, ToolsSettings, WebSearchSettings };

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  schema: 'air.tools/1',
  connections: [],
  definitions: [],
};

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  schema: 'air.web-search/1',
  enabled: true,
  endpoint: null,
  options: {},
};

export const DEFAULT_MODEL_HARNESS_SETTINGS: ModelHarnessSettings = {
  schema: 'air.model-harness/1',
  fullHarness: [],
};

function settingsPath(root: string, relative: string): string {
  return resolveUnderVault(root, relative);
}

function readOrDefault<T>(absolute: string, parse: (bytes: string) => T, fallback: T): T {
  if (!existsSync(absolute)) return structuredClone(fallback);
  return parse(readFileSync(absolute, 'utf8'));
}

/** Ensure the three vault settings files exist with schema defaults. */
export function ensureVaultSettingsFiles(vaultRoot = resolveVaultRoot()): void {
  const root = resolveVaultRoot(vaultRoot);
  const tools = settingsPath(root, VAULT_PATHS.toolsSettings);
  const web = settingsPath(root, VAULT_PATHS.webSearchSettings);
  const harness = settingsPath(root, VAULT_PATHS.modelHarnessSettings);
  for (const path of [tools, web, harness]) mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(tools)) writeYamlSettings(tools, DEFAULT_TOOLS_SETTINGS);
  if (!existsSync(web)) writeYamlSettings(web, DEFAULT_WEB_SEARCH_SETTINGS);
  if (!existsSync(harness)) writeYamlSettings(harness, DEFAULT_MODEL_HARNESS_SETTINGS);
}

export function readToolsSettingsFile(vaultRoot = resolveVaultRoot()): ToolsSettings {
  const root = resolveVaultRoot(vaultRoot);
  return readOrDefault(settingsPath(root, VAULT_PATHS.toolsSettings), parseToolsSettings, DEFAULT_TOOLS_SETTINGS);
}

export function writeToolsSettingsFile(value: ToolsSettings, vaultRoot = resolveVaultRoot()): void {
  const root = resolveVaultRoot(vaultRoot);
  const absolute = settingsPath(root, VAULT_PATHS.toolsSettings);
  mkdirSync(dirname(absolute), { recursive: true });
  if (value.schema !== 'air.tools/1') throw new Error('tools.yaml schema must be air.tools/1.');
  writeYamlSettings(absolute, value);
}

export function readWebSearchSettingsFile(vaultRoot = resolveVaultRoot()): WebSearchSettings {
  const root = resolveVaultRoot(vaultRoot);
  return readOrDefault(settingsPath(root, VAULT_PATHS.webSearchSettings), parseWebSearchSettings, DEFAULT_WEB_SEARCH_SETTINGS);
}

export function writeWebSearchSettingsFile(value: WebSearchSettings, vaultRoot = resolveVaultRoot()): void {
  const root = resolveVaultRoot(vaultRoot);
  const absolute = settingsPath(root, VAULT_PATHS.webSearchSettings);
  mkdirSync(dirname(absolute), { recursive: true });
  if (value.schema !== 'air.web-search/1') throw new Error('web-search.yaml schema must be air.web-search/1.');
  writeYamlSettings(absolute, value);
}

export function readModelHarnessSettingsFile(vaultRoot = resolveVaultRoot()): ModelHarnessSettings {
  const root = resolveVaultRoot(vaultRoot);
  return readOrDefault(settingsPath(root, VAULT_PATHS.modelHarnessSettings), parseModelHarnessSettings, DEFAULT_MODEL_HARNESS_SETTINGS);
}

export function writeModelHarnessSettingsFile(value: ModelHarnessSettings, vaultRoot = resolveVaultRoot()): void {
  const root = resolveVaultRoot(vaultRoot);
  const absolute = settingsPath(root, VAULT_PATHS.modelHarnessSettings);
  mkdirSync(dirname(absolute), { recursive: true });
  if (value.schema !== 'air.model-harness/1') throw new Error('model-harness.yaml schema must be air.model-harness/1.');
  writeYamlSettings(absolute, value);
}

/** Runtime-only reachability check beside the vault settings (not portable user config). */
export function webSearchCheckPath(vaultRoot = resolveVaultRoot()): string {
  return join(resolveUnderVault(resolveVaultRoot(vaultRoot), VAULT_PATHS.runtime), 'web-search-check.json');
}
