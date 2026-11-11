import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteText } from '@office/vault/atomic';
import { parseAutomationYaml, serializeAutomationYaml } from '@office/vault/automation';
import type { VaultAutomationDefinition } from '@office/vault/automation';
import { automationRelative, normalizeVaultRelative } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot } from '@office/vault/host';
import { ensureVaultLayout } from '@office/vault/service';
import type { AutomationDefinition } from './automations.domain.public';
import { validateAutomation } from './automations.domain.public';
import type { AutomationStore } from './automation-store.port';
import { createSqliteOccurrenceStore } from './automation-occurrence.adapter';

function toDomain(path: string, value: VaultAutomationDefinition): AutomationDefinition {
  const now = new Date().toISOString();
  return {
    id: value.id,
    path,
    name: value.name,
    enabled: value.enabled,
    missedRunPolicy: value.missedRunPolicy,
    recurrence: value.recurrence,
    steps: value.steps as AutomationDefinition['steps'],
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}

function toVault(definition: AutomationDefinition): VaultAutomationDefinition {
  return {
    schema: 'air.automation/1',
    id: definition.id,
    name: definition.name,
    enabled: definition.enabled,
    missedRunPolicy: definition.missedRunPolicy,
    recurrence: definition.recurrence,
    steps: definition.steps as VaultAutomationDefinition['steps'],
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

function readDefinition(absolute: string, relative: string): AutomationDefinition {
  try {
    const parsed = parseAutomationYaml(readFileSync(absolute, 'utf8'));
    const definition = toDomain(relative, parsed);
    if (!validateAutomation(definition)) throw new Error('Automation failed domain validation.');
    return definition;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid automation at ${relative}: ${detail}`);
  }
}

/**
 * Automation definitions as vault `automations/<slug>.automation.yaml` files.
 * Occurrences remain SQLite under `.air/runtime`, keyed by automation path.
 */
export function createVaultAutomationStore(options: { vaultRoot?: string; occurrencesPath?: string } = {}): AutomationStore {
  const root = resolveVaultRoot(options.vaultRoot);
  const paths = ensureVaultLayout(root);
  const automationsDir = paths.automations;
  const occurrences = createSqliteOccurrenceStore(options.occurrencesPath ?? join(paths.runtime, 'automations.sqlite'));

  function allFiles(): { absolute: string; relative: string }[] {
    if (!existsSync(automationsDir)) return [];
    return readdirSync(automationsDir)
      .filter((name) => name.endsWith('.automation.yaml'))
      .map((name) => ({ absolute: join(automationsDir, name), relative: normalizeVaultRelative(`automations/${name}`) }));
  }

  function loadAll(): AutomationDefinition[] {
    return allFiles()
      .map((file) => readDefinition(file.absolute, file.relative))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function absoluteFor(definition: AutomationDefinition): { absolute: string; relative: string } {
    const relative = definition.path || automationRelative(definition.id);
    return { absolute: resolveUnderVault(root, relative), relative: normalizeVaultRelative(relative) };
  }

  return {
    list: () => loadAll(),
    get: (id) => loadAll().find((item) => item.id === id) ?? null,
    getByPath: (path) => {
      const relative = normalizeVaultRelative(path);
      const absolute = resolveUnderVault(root, relative);
      if (!existsSync(absolute)) return null;
      return readDefinition(absolute, relative);
    },
    save: (definition) => {
      const relative = definition.path || automationRelative(definition.id);
      const candidate: AutomationDefinition = { ...definition, path: relative };
      if (!validateAutomation(candidate)) throw new Error('Invalid automation.');
      const normalizedPath = normalizeVaultRelative(relative);
      const pathOwner = loadAll().find((item) => normalizeVaultRelative(item.path) === normalizedPath);
      if (pathOwner && pathOwner.id !== candidate.id) {
        throw new Error('An automation already exists at this path.');
      }
      const prior = loadAll().find((item) => item.id === candidate.id);
      if (prior && (!candidate.enabled || JSON.stringify(prior.recurrence) !== JSON.stringify(candidate.recurrence))) {
        occurrences.skipPending(prior.path);
      }
      if (prior && prior.path !== candidate.path && existsSync(resolveUnderVault(root, prior.path))) {
        unlinkSync(resolveUnderVault(root, prior.path));
        occurrences.skipPending(prior.path);
      }
      const { absolute } = absoluteFor(candidate);
      atomicWriteText(absolute, serializeAutomationYaml(toVault(candidate)));
      return candidate;
    },
    remove: (id) => {
      const existing = loadAll().find((item) => item.id === id);
      if (!existing) return;
      occurrences.skipPending(existing.path);
      const absolute = resolveUnderVault(root, existing.path);
      if (existsSync(absolute)) unlinkSync(absolute);
    },
    due: (now) => occurrences.due(now),
    ensureOccurrence: (automationPath, scheduledAt, at) => occurrences.ensureOccurrence(automationPath, scheduledAt, at),
    createManualOccurrence: (automationPath, at) => occurrences.createManualOccurrence(automationPath, at),
    startOccurrence: (id, jobId, at) => occurrences.startOccurrence(id, jobId, at),
    skipOccurrence: (id, at) => occurrences.skipOccurrence(id, at),
    recordOutcome: (id, state, completedSteps, error, at) => occurrences.recordOutcome(id, state, completedSteps, error, at),
    history: (automationPath, limit) => occurrences.history(automationPath, limit),
    clearPersonalData: () => {
      for (const file of allFiles()) {
        if (existsSync(file.absolute)) unlinkSync(file.absolute);
      }
      occurrences.clear();
    },
    close: () => occurrences.close(),
  };
}
