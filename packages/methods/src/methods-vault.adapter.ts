import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertNoUnknownKeys, parseFrontmatter, serializeFrontmatter } from '@office/vault/frontmatter';
import { atomicWriteText } from '@office/vault/atomic';
import { ensureVaultLayout, vaultPaths } from '@office/vault/service';
import { slugify } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot } from '@office/vault/host';
import type { MethodDefinition, MethodVersion, MethodsBundle } from './methods.domain.public';
import { validateDefinition, validateMethodsBundle } from './methods.domain.public';
import type { MethodsImportConflict, MethodsImportResult, MethodsStore } from './methods.service.public';

const SKILL_KEYS = ['name', 'description'] as const;
const PROMPT_KEYS = ['name', 'variables'] as const;
const AGENT_KEYS = [
  'name', 'description', 'model', 'provider', 'modelReference',
  'temperature', 'maxOutputTokens', 'reasoningEffort',
  'knowledgeCollectionIds', 'skillIds', 'toolIds',
] as const;

function assertString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function assertStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) {
    throw new Error(`Invalid ${label}.`);
  }
  return value as string[];
}

function historyDir(root: string, definitionId: string): string {
  return resolveUnderVault(root, `.air/runtime/methods/${slugify(definitionId)}`);
}

/** Folder/file key for a method id. Craft ids use `:`, which Windows rejects in paths. */
function methodStorageKey(id: string): string {
  return /[<>:"/\\|?*\u0000-\u001f]/.test(id) ? encodeURIComponent(id) : id;
}

function methodIdFromStorageKey(key: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(key)) return key;
  try { return decodeURIComponent(key); } catch { return key; }
}

function skillPath(root: string, id: string): string {
  return resolveUnderVault(root, `.air/skills/${methodStorageKey(id)}/SKILL.md`);
}

function promptPath(root: string, id: string): string {
  return resolveUnderVault(root, `.air/prompts/${methodStorageKey(id)}.prompt.md`);
}

function agentPath(root: string, id: string): string {
  return resolveUnderVault(root, `.air/agents/${methodStorageKey(id)}.agent.md`);
}

function parseSkillFile(id: string, raw: string, updatedAt: string): MethodDefinition {
  const doc = parseFrontmatter(raw);
  assertNoUnknownKeys(doc.data, [...SKILL_KEYS]);
  const name = assertString(doc.data.name, 'skill name', 120);
  if (typeof doc.data.description !== 'string' || doc.data.description.length > 500) throw new Error('Invalid skill description.');
  const definition: MethodDefinition = {
    kind: 'skill',
    value: { id, name, description: doc.data.description, instructions: doc.body.replace(/^\uFEFF/, ''), updatedAt },
  };
  if (!validateDefinition(definition)) throw new Error(`Invalid skill file for ${id}.`);
  return definition;
}

function parsePromptFile(id: string, raw: string, updatedAt: string): MethodDefinition {
  const doc = parseFrontmatter(raw);
  assertNoUnknownKeys(doc.data, [...PROMPT_KEYS]);
  const name = assertString(doc.data.name, 'prompt name', 120);
  const variables = assertStringList(doc.data.variables ?? [], 'prompt variables');
  if (!variables.every((variable) => /^[a-z][a-z0-9_]*$/.test(variable))) throw new Error('Invalid prompt variable names.');
  const definition: MethodDefinition = {
    kind: 'prompt',
    value: { id, name, instructions: doc.body.replace(/^\uFEFF/, ''), variables, updatedAt },
  };
  if (!validateDefinition(definition)) throw new Error(`Invalid prompt file for ${id}.`);
  return definition;
}

function parseAgentFile(id: string, raw: string, updatedAt: string): MethodDefinition {
  const doc = parseFrontmatter(raw);
  assertNoUnknownKeys(doc.data, [...AGENT_KEYS]);
  const name = assertString(doc.data.name, 'agent name', 120);
  const model = assertString(doc.data.model, 'agent model', 200);
  const provider = doc.data.provider === undefined ? undefined : assertString(doc.data.provider, 'agent provider', 200);
  let modelReference: { providerId: string; modelId: string; role: 'chat' | 'background' } | undefined;
  if (doc.data.modelReference !== undefined) {
    if (!doc.data.modelReference || typeof doc.data.modelReference !== 'object' || Array.isArray(doc.data.modelReference)) {
      throw new Error('Invalid agent modelReference.');
    }
    const reference = doc.data.modelReference as Record<string, unknown>;
    assertNoUnknownKeys(reference, ['providerId', 'modelId', 'role']);
    const role = reference.role;
    if (role !== 'chat' && role !== 'background') throw new Error('Invalid agent modelReference.role.');
    modelReference = {
      providerId: assertString(reference.providerId, 'modelReference.providerId', 200),
      modelId: assertString(reference.modelId, 'modelReference.modelId', 200),
      role,
    };
  }
  const temperature = doc.data.temperature;
  const maxOutputTokens = doc.data.maxOutputTokens;
  const reasoningEffort = doc.data.reasoningEffort;
  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) throw new Error('Invalid temperature.');
  if (maxOutputTokens !== undefined && (typeof maxOutputTokens !== 'number' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
    throw new Error('Invalid maxOutputTokens.');
  }
  if (reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(String(reasoningEffort))) {
    throw new Error('Invalid reasoningEffort.');
  }
  const knowledgeCollectionIds = assertStringList(doc.data.knowledgeCollectionIds ?? [], 'knowledgeCollectionIds');
  const skillIds = assertStringList(doc.data.skillIds ?? [], 'skillIds');
  const toolIds = assertStringList(doc.data.toolIds ?? [], 'toolIds');
  const settings: { temperature?: number; maxOutputTokens?: number; reasoningEffort?: string } = {};
  if (temperature !== undefined) settings.temperature = temperature;
  if (maxOutputTokens !== undefined) settings.maxOutputTokens = maxOutputTokens;
  if (typeof reasoningEffort === 'string') settings.reasoningEffort = reasoningEffort;
  const definition: MethodDefinition = {
    kind: 'preset',
    value: {
      id,
      name,
      model: modelReference?.modelId ?? model,
      ...(provider || modelReference ? { provider: modelReference?.providerId ?? provider } : {}),
      ...(modelReference ? { modelReference } : {}),
      instructions: doc.body.replace(/^\uFEFF/, ''),
      settings,
      knowledgeCollectionIds,
      skillIds,
      toolIds,
      updatedAt,
    },
  };
  if (!validateDefinition(definition)) throw new Error(`Invalid agent file for ${id}.`);
  return definition;
}

function serializeDefinition(definition: MethodDefinition): string {
  if (definition.kind === 'skill') {
    return serializeFrontmatter({ name: definition.value.name, description: definition.value.description }, definition.value.instructions);
  }
  if (definition.kind === 'prompt') {
    return serializeFrontmatter({ name: definition.value.name, variables: definition.value.variables }, definition.value.instructions);
  }
  const data: Record<string, unknown> = {
    name: definition.value.name,
    model: definition.value.modelReference?.modelId ?? definition.value.model,
  };
  if (definition.value.provider) data.provider = definition.value.provider;
  if (definition.value.modelReference) data.modelReference = definition.value.modelReference;
  if (definition.value.settings.temperature !== undefined) data.temperature = definition.value.settings.temperature;
  if (definition.value.settings.maxOutputTokens !== undefined) data.maxOutputTokens = definition.value.settings.maxOutputTokens;
  const effort = (definition.value.settings as { reasoningEffort?: string }).reasoningEffort;
  if (effort !== undefined) data.reasoningEffort = effort;
  data.knowledgeCollectionIds = definition.value.knowledgeCollectionIds;
  data.skillIds = definition.value.skillIds;
  data.toolIds = definition.value.toolIds;
  return serializeFrontmatter(data, definition.value.instructions);
}

function fileMtimeIso(path: string): string {
  try {
    return new Date(Bun.file(path).lastModified).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function appendHistory(root: string, definition: MethodDefinition): void {
  const dir = historyDir(root, definition.value.id);
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  const revision = existing.reduce((max, name) => Math.max(max, Number(name.replace(/\.json$/, ''))), 0) + 1;
  const version: MethodVersion = {
    id: crypto.randomUUID(),
    definitionId: definition.value.id,
    kind: definition.kind,
    revision,
    savedAt: definition.value.updatedAt,
    value: definition.value,
  };
  atomicWriteText(join(dir, `${revision}.json`), `${JSON.stringify(version)}\n`);
}

/** Vault-backed methods store. Definitions are files; history is rebuildable audit under `.air/runtime/methods/`. */
export function createVaultMethodsStore(root = resolveVaultRoot()): MethodsStore {
  ensureVaultLayout(root);
  const paths = vaultPaths(root);

  const readAll = (): MethodDefinition[] => {
    const definitions: MethodDefinition[] = [];
    if (existsSync(paths.skills)) {
      for (const entry of readdirSync(paths.skills, { withFileTypes: true }).filter((item) => item.isDirectory())) {
        const id = methodIdFromStorageKey(entry.name);
        const path = skillPath(root, id);
        if (!existsSync(path)) continue;
        definitions.push(parseSkillFile(id, readFileSync(path, 'utf8'), fileMtimeIso(path)));
      }
    }
    if (existsSync(paths.prompts)) {
      for (const name of readdirSync(paths.prompts).filter((file) => file.endsWith('.prompt.md'))) {
        const id = methodIdFromStorageKey(name.slice(0, -'.prompt.md'.length));
        const path = promptPath(root, id);
        definitions.push(parsePromptFile(id, readFileSync(path, 'utf8'), fileMtimeIso(path)));
      }
    }
    if (existsSync(paths.agents)) {
      for (const name of readdirSync(paths.agents).filter((file) => file.endsWith('.agent.md'))) {
        const id = methodIdFromStorageKey(name.slice(0, -'.agent.md'.length));
        const path = agentPath(root, id);
        definitions.push(parseAgentFile(id, readFileSync(path, 'utf8'), fileMtimeIso(path)));
      }
    }
    return definitions.sort((left, right) => right.value.updatedAt.localeCompare(left.value.updatedAt) || left.value.id.localeCompare(right.value.id));
  };

  const get = (id: string): MethodDefinition | null => readAll().find((definition) => definition.value.id === id) ?? null;

  const writeDefinition = (definition: MethodDefinition): void => {
    const bytes = serializeDefinition(definition);
    if (definition.kind === 'skill') {
      mkdirSync(dirname(skillPath(root, definition.value.id)), { recursive: true });
      atomicWriteText(skillPath(root, definition.value.id), bytes);
      return;
    }
    if (definition.kind === 'prompt') {
      atomicWriteText(promptPath(root, definition.value.id), bytes);
      return;
    }
    atomicWriteText(agentPath(root, definition.value.id), bytes);
  };

  const removeFiles = (id: string): void => {
    for (const path of [skillPath(root, id), promptPath(root, id), agentPath(root, id)]) {
      if (existsSync(path)) unlinkSync(path);
    }
    const skillDir = dirname(skillPath(root, id));
    if (existsSync(skillDir) && readdirSync(skillDir).length === 0) rmSync(skillDir, { recursive: true, force: true });
  };

  const save = (definition: MethodDefinition): MethodDefinition => {
    if (!validateDefinition(definition)) throw new Error('Invalid method definition.');
    const existing = get(definition.value.id);
    if (existing && existing.kind !== definition.kind) throw new Error('A method identity cannot change kind.');
    const now = new Date().toISOString();
    let next = { kind: definition.kind, value: { ...definition.value, updatedAt: now } } as MethodDefinition;
    if (next.kind === 'preset') {
      const reference = next.value.modelReference ?? (next.value.provider
        ? { providerId: next.value.provider, modelId: next.value.model, role: 'chat' as const }
        : undefined);
      if (reference) {
        next = {
          kind: 'preset',
          value: { ...next.value, provider: reference.providerId, model: reference.modelId, modelReference: reference },
        };
      }
    }
    writeDefinition(next);
    appendHistory(root, next);
    return next;
  };

  const findVersion = (versionId: string): MethodVersion | null => {
    const runtime = resolveUnderVault(root, '.air/runtime/methods');
    if (!existsSync(runtime)) return null;
    for (const id of readdirSync(runtime, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      const dir = join(runtime, id);
      for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
        const raw: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as MethodVersion).id === versionId) {
          return raw as MethodVersion;
        }
      }
    }
    return null;
  };

  return {
    list: () => readAll(),
    get,
    save,
    history: (id) => {
      const dir = historyDir(root, id);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => /^\d+\.json$/.test(name))
        .map((name) => Number(name.replace(/\.json$/, '')))
        .sort((left, right) => right - left)
        .map((revision) => JSON.parse(readFileSync(join(dir, `${revision}.json`), 'utf8')) as MethodVersion);
    },
    restore: (versionId, expectedDefinitionId) => {
      const version = findVersion(versionId);
      if (!version || (expectedDefinitionId !== undefined && version.definitionId !== expectedDefinitionId)) return null;
      const restored = { kind: version.kind, value: version.value } as MethodDefinition;
      if (!validateDefinition(restored)) throw new Error('Method version does not match the current definition identity.');
      const current = get(version.definitionId);
      if (current && current.kind !== restored.kind) throw new Error('Method version does not match the current definition identity.');
      return save(restored);
    },
    exportBundle: (): MethodsBundle => ({ format: 'air-office.methods', version: 1, definitions: readAll() }),
    clearAll: () => {
      const all = readAll();
      for (const definition of all) removeFiles(definition.value.id);
      const runtime = resolveUnderVault(root, '.air/runtime/methods');
      if (existsSync(runtime)) rmSync(runtime, { recursive: true, force: true });
      return all.length;
    },
    remove: (id) => { removeFiles(id); },
    importBundle: (bundle): MethodsImportResult => {
      if (!validateMethodsBundle(bundle)) throw new Error('Invalid methods bundle or unsupported bundle version.');
      const imported: MethodDefinition[] = [];
      const conflicts: MethodsImportConflict[] = [];
      for (const definition of bundle.definitions) {
        const existing = get(definition.value.id);
        if (existing) conflicts.push({ id: definition.value.id, existingKind: existing.kind, incomingKind: definition.kind });
        else imported.push(save(definition));
      }
      return { imported, conflicts };
    },
    close: () => undefined,
  };
}
