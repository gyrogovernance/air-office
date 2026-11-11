import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  writeYamlSettings,
} from './settings.codec.public';
import {
  VAULT_PATHS,
  VAULT_VERSION,
} from './vault.domain.public';
import { resolveUnderVault, resolveVaultRoot, toVaultRelative } from './vault.host.public';
import { ensureVaultSettingsFiles } from './vault-settings.authority.public';

export {
  VAULT_PATHS,
  VAULT_VERSION,
  normalizeVaultRelative,
  slugify,
  noteJsonRelative,
  noteMarkdownRelative,
  programNotesDir,
  programChatsDir,
  calendarRelative,
  automationRelative,
  actionRelative,
  packActionRelative,
} from './vault.domain.public';
export {
  resolveUnderVault,
  resolveVaultRoot,
  toVaultRelative,
  joinVault,
  sha256Text,
  sha256Bytes,
} from './vault.host.public';

export type VaultPaths = {
  root: string;
  programs: string;
  calendar: string;
  automations: string;
  actions: string;
  packActions: string;
  agents: string;
  skills: string;
  prompts: string;
  settings: string;
  trash: string;
  runtime: string;
  memoryFacts: string;
  memoryEpisodes: string;
  sources: string;
  vaultVersion: string;
};

export function vaultPaths(root = resolveVaultRoot()): VaultPaths {
  return {
    root,
    programs: resolveUnderVault(root, VAULT_PATHS.programs),
    calendar: resolveUnderVault(root, VAULT_PATHS.calendar),
    automations: resolveUnderVault(root, VAULT_PATHS.automations),
    actions: resolveUnderVault(root, VAULT_PATHS.actions),
    packActions: resolveUnderVault(root, VAULT_PATHS.packActions),
    agents: resolveUnderVault(root, VAULT_PATHS.agents),
    skills: resolveUnderVault(root, VAULT_PATHS.skills),
    prompts: resolveUnderVault(root, VAULT_PATHS.prompts),
    settings: resolveUnderVault(root, VAULT_PATHS.settings),
    trash: resolveUnderVault(root, VAULT_PATHS.trash),
    runtime: resolveUnderVault(root, VAULT_PATHS.runtime),
    memoryFacts: resolveUnderVault(root, VAULT_PATHS.memoryFacts),
    memoryEpisodes: resolveUnderVault(root, VAULT_PATHS.memoryEpisodes),
    sources: resolveUnderVault(root, VAULT_PATHS.sources),
    vaultVersion: resolveUnderVault(root, VAULT_PATHS.vaultVersion),
  };
}

/** Create the vault skeleton and default settings when missing. */
export function ensureVaultLayout(root = resolveVaultRoot()): VaultPaths {
  const paths = vaultPaths(root);
  for (const dir of [
    paths.programs,
    join(paths.programs, 'general', 'notes'),
    join(paths.programs, 'general', 'chats'),
    join(paths.programs, 'general', 'projects'),
    paths.calendar,
    paths.automations,
    paths.actions,
    paths.packActions,
    paths.agents,
    paths.skills,
    paths.prompts,
    paths.settings,
    paths.trash,
    paths.runtime,
    paths.memoryEpisodes,
    join(paths.root, 'memory'),
    paths.sources,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const instruction = join(paths.programs, 'general', 'instruction.md');
  if (!existsSync(instruction)) writeFileSync(instruction, '# General\n', 'utf8');
  if (!existsSync(paths.memoryFacts)) writeFileSync(paths.memoryFacts, '', 'utf8');
  if (!existsSync(join(paths.settings, 'workspace.yaml'))) {
    writeYamlSettings(join(paths.settings, 'workspace.yaml'), DEFAULT_WORKSPACE_SETTINGS);
  }
  ensureVaultSettingsFiles(root);
  return paths;
}

export function readVaultVersion(root = resolveVaultRoot()): number | null {
  const path = resolveUnderVault(root, VAULT_PATHS.vaultVersion);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').trim();
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid vault-version file: ${raw}`);
  return value;
}

export function writeVaultVersion(root = resolveVaultRoot(), version = VAULT_VERSION): void {
  const paths = ensureVaultLayout(root);
  writeFileSync(paths.vaultVersion, `${version}\n`, 'utf8');
}
