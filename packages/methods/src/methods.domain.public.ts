export { craftPackageSchema, craftCommandSchema, gyroscopicCraftPackage, humanMarkCraftPackage, parseCraftPackage, CRAFT_PACKAGE_MAX_BYTES, SHIPPED_COMPOSITION_CRAFT_IDS, craftReference, craftComponentId } from './craft-package.policy';
export type { CraftPackage, CraftRecord, CraftResource, CraftBindings, CraftSnapshot, CraftResourceKind, CraftCommand } from './craft-package.policy';

export function splitSkillFrontmatter(text: string): { frontmatter: string; body: string } | null {
  const start = text.startsWith('---\r\n') ? 5 : text.startsWith('---\n') ? 4 : -1;
  if (start < 0) return null;
  let lineStart = start;
  while (lineStart < text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) return null;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (lineStart > start && line === '---') {
      return { frontmatter: text.slice(start, lineStart - 1).replace(/\r$/, ''), body: text.slice(lineEnd + 1) };
    }
    lineStart = lineEnd + 1;
  }
  return null;
}

export type PresetSettings = {
  temperature?: number;
  maxOutputTokens?: number;
};

export type ModelPreset = {
  id: string;
  name: string;
  model: string;
  provider?: string;
  modelReference?: { providerId: string; modelId: string; role: 'chat' | 'background' };
  instructions: string;
  settings: PresetSettings;
  knowledgeCollectionIds: string[];
  skillIds: string[];
  toolIds: string[];
  updatedAt: string;
};

export type SavedPrompt = {
  id: string;
  name: string;
  instructions: string;
  variables: string[];
  updatedAt: string;
};

export type ReusableSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  updatedAt: string;
};

export type MethodDefinition =
  | { kind: 'preset'; value: ModelPreset }
  | { kind: 'prompt'; value: SavedPrompt }
  | { kind: 'skill'; value: ReusableSkill };

export type MethodVersion = { id: string; definitionId: string; kind: MethodDefinition['kind']; revision: number; savedAt: string; value: MethodDefinition['value'] };
export type MethodsBundle = { format: 'air-office.methods'; version: 1; definitions: MethodDefinition[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value);
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === value.slice(0, 10) && Number(value.slice(11, 13)) <= 23 && Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59;
}

function isIdentityList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isIdentity) && new Set(value).size === value.length;
}

export function validateDefinition(value: unknown): value is MethodDefinition {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'value']) || !isRecord(value.value)) return false;
  const data = value.value;
  const common = ['id', 'name', 'instructions', 'updatedAt'];
  if (!isIdentity(data.id) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 120 || !isTimestamp(data.updatedAt) || typeof data.instructions !== 'string') return false;
  if (value.kind === 'preset') {
    if (!hasOnlyKeys(data, [...common, 'model', 'provider', 'modelReference', 'settings', 'knowledgeCollectionIds', 'skillIds', 'toolIds']) || !isIdentity(data.model) || (data.provider !== undefined && !isIdentity(data.provider)) || (data.modelReference !== undefined && (!isRecord(data.modelReference) || !isIdentity(data.modelReference.providerId) || !isIdentity(data.modelReference.modelId) || !['chat', 'background'].includes(String(data.modelReference.role)))) || !isRecord(data.settings) || !hasOnlyKeys(data.settings, ['temperature', 'maxOutputTokens', 'reasoningEffort'])) return false;
    const { temperature, maxOutputTokens, reasoningEffort } = data.settings;
    return (temperature === undefined || (typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2)) && (maxOutputTokens === undefined || (typeof maxOutputTokens === 'number' && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens >= 1)) && (reasoningEffort === undefined || typeof reasoningEffort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) && isIdentityList(data.knowledgeCollectionIds) && isIdentityList(data.skillIds) && isIdentityList(data.toolIds);
  }
  if (value.kind === 'prompt') return hasOnlyKeys(data, [...common, 'variables']) && Array.isArray(data.variables) && data.variables.every((variable) => typeof variable === 'string' && /^[a-z][a-z0-9_]*$/.test(variable)) && new Set(data.variables).size === data.variables.length;
  return value.kind === 'skill' && hasOnlyKeys(data, [...common, 'description']) && typeof data.description === 'string' && data.description.length <= 500;
}

export function validateMethodsBundle(value: unknown): value is MethodsBundle {
  if (!isRecord(value) || !hasOnlyKeys(value, ['format', 'version', 'definitions'])) return false;
  return value.format === 'air-office.methods' && value.version === 1 && Array.isArray(value.definitions) && value.definitions.every(validateDefinition) && new Set(value.definitions.map((definition) => definition.value.id)).size === value.definitions.length;
}

export function resolvePrompt(prompt: SavedPrompt, values: Record<string, string>): { content: string; missing: string[] } {
  const referenced = [...prompt.instructions.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((match) => match[1]!);
  const missing = [...new Set([...prompt.variables, ...referenced])].filter((variable) => typeof values[variable] !== 'string' || !values[variable]!.trim());
  const content = prompt.instructions.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (match, name: string) => typeof values[name] === 'string' ? values[name]! : match);
  return { content, missing };
}

export type MethodInstructionOptions = {
  /**
   * How skill bodies travel with the run. `inline` pastes full skill text into
   * the system prompt so selected skills (including AI-safety skills) govern
   * every turn. `catalog` only names skills for Copilot's on-demand skill tool.
   */
  skillBodies?: 'inline' | 'catalog';
};

/**
 * Skills that must stay standing when selected: Human Mark, Market AI governance
 * and oversight installs, and other AI-safety oriented skills.
 */
export function isAiSafetySkill(skill: Pick<ReusableSkill, 'id' | 'name' | 'description' | 'instructions'>): boolean {
  if (skill.id === 'lab-skill-the-human-mark' || skill.id === 'the-human-mark') return true;
  if (/human[\s-]?mark/i.test(skill.name)) return true;
  if (/Library:\s*(AI governance toolkit|OWASP GenAI Security Advisor|OWASP Secure Agent Playbook)/i.test(skill.instructions)) return true;
  if (/Category:\s*(AI security|Code security|AI Governance|AI Oversight)/i.test(skill.instructions)) return true;
  const haystack = `${skill.name}\n${skill.description}\n${skill.instructions.slice(0, 4_000)}`;
  return /\b(ai safety|responsible ai|owasp|genai security|ai governance|alignment|the human mark)\b/i.test(haystack);
}

/**
 * The instructions a conversation sends, and the prompt variables it still needs.
 *
 * An agent may name skills. The catalogue supplies those skills when they are
 * not themselves attached to the chat. With `skillBodies: 'catalog'`, only the
 * skill name and description travel in the prompt; Copilot loads the body through
 * the skill tool when needed.
 */
export function resolveMethodInstructions(definitions: MethodDefinition[], values: Record<string, Record<string, string>>, catalogue: readonly MethodDefinition[] = definitions, options: MethodInstructionOptions = {}): { content: string; missing: string[] } {
  const missing: string[] = [];
  const resolved = definitions.map((definition): MethodDefinition => {
    if (definition.kind !== 'prompt') return definition;
    const result = resolvePrompt(definition.value, values[definition.value.id] ?? {});
    missing.push(...result.missing.map((name) => `${definition.value.name}: ${name}`));
    return { kind: 'prompt', value: { ...definition.value, instructions: result.content } };
  });
  const named = new Set(resolved.filter(definition => definition.kind === 'skill').map(definition => definition.value.id));
  const skills = resolved.filter(definition => definition.kind === 'preset')
    .flatMap(definition => definition.value.skillIds)
    .filter(id => !named.has(id))
    .map(id => catalogue.find(definition => definition.kind === 'skill' && definition.value.id === id))
    .filter((definition): definition is MethodDefinition => definition !== undefined);
  return { content: effectiveInstructions([...resolved, ...skills], options), missing };
}

export function effectiveInstructions(definitions: MethodDefinition[], options: MethodInstructionOptions = {}): string {
  const skillBodies = options.skillBodies ?? 'inline';
  const agentsAndPrompts = definitions.filter((definition) => definition.kind !== 'skill');
  const skills = definitions.filter((definition): definition is Extract<MethodDefinition, { kind: 'skill' }> => definition.kind === 'skill');
  const parts = agentsAndPrompts.map((definition) => `${definition.kind === 'preset' ? 'AGENT' : definition.kind.toUpperCase()}: ${definition.value.name}\n${definition.value.instructions}`);
  if (skills.length) {
    if (skillBodies === 'catalog') {
      parts.push(`Available skills (load with the skill tool when needed):\n${skills.map((skill) => `- ${skill.value.name}: ${skill.value.description || skill.value.name}`).join('\n')}`);
    } else {
      parts.push(...skills.map((skill) => `SKILL: ${skill.value.name}\n${skill.value.instructions}`));
    }
  }
  return parts.filter(Boolean).join('\n\n');
}
