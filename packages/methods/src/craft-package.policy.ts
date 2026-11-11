import { z } from 'zod';
import { validateRecurrence } from '@office/calendar/domain';
import type { Recurrence } from '@office/calendar/domain';
import { validateDefinition } from './methods.domain.public';
import type { MethodDefinition } from './methods.domain.public';

const identifier = z.string().min(1).max(200);
export const craftResourceKindSchema = z.enum(['model', 'embedding', 'tool', 'mcp', 'knowledge', 'calendar', 'conversation']);
const stepSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('action'), actionPath: identifier, source: z.string().min(1).max(200000), instructions: z.string().max(20000), model: identifier, definition: z.strictObject({ name: z.string().min(1).max(120).refine(value => value.trim().length > 0), system: z.string().max(200000), runPrompts: z.array(z.string().min(1).max(200000).refine(value => value.trim().length > 0)).min(1).max(12) }) }),
  z.strictObject({ kind: z.literal('prompt'), prompt: z.string().max(20000), model: identifier }),
  z.strictObject({ kind: z.literal('tool'), toolId: identifier, input: z.record(z.string(), z.unknown()) }),
  z.strictObject({ kind: z.literal('calendar-event'), calendarPath: identifier, title: z.string().min(1).max(200), daysAfterRun: z.number().int().min(0).max(365), allDay: z.boolean(), time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional() }),
  z.strictObject({ kind: z.literal('chat-message'), conversationPath: identifier }),
]);
export const craftPackageSchema = z.strictObject({
  format: z.literal('air-office.craft'),
  formatVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  runtime: z.enum(['composition', 'gyroscopic-reasoning', 'human-mark']),
  requirements: z.array(z.strictObject({ key: identifier, kind: craftResourceKindSchema, label: z.string().min(1).max(200), suggested: identifier.optional(), connection: identifier.optional(), optional: z.boolean().default(false) })).max(100),
  methods: z.array(z.custom<MethodDefinition>(validateDefinition)).max(50),
  automations: z.array(z.strictObject({ id: identifier, name: z.string().min(1).max(120), recurrence: z.custom<Recurrence>(validateRecurrence), missedRunPolicy: z.enum(['skip', 'run-once']), steps: z.array(stepSchema).min(1).max(20) })).max(20),
}).superRefine((craft, context) => {
  const error = (message: string) => context.addIssue({ code: 'custom', message });
  for (const values of [craft.requirements.map(item => item.key), craft.methods.map(item => item.value.id), craft.automations.map(item => item.id)]) {
    if (new Set(values).size !== values.length) error('Component and requirement identities must be unique.');
  }
  if ((craft.runtime === 'gyroscopic-reasoning') !== (craft.id === 'gyroscopic-reasoning') || (craft.runtime === 'human-mark') !== (craft.id === 'the-human-mark')) error('Built-in crafts use their reserved identities.');
  if (craft.runtime === 'composition' && !craft.methods.length && !craft.automations.length && !craft.requirements.some(item => item.kind === 'knowledge')) error('Choose at least one resource or action.');
  for (const requirement of craft.requirements) if (requirement.connection && (requirement.kind !== 'tool' || !craft.requirements.some(item => item.kind === 'mcp' && item.key === requirement.connection && !item.optional))) error('A tool connection must reference a required MCP resource.');
  function reference(value: string, kind: CraftResourceKind) {
    // Literals (for example Lab `unassigned`) stay unbound until Agents, Actions, or chat choose a model. Only `@craft:` slots need package requirements.
    if (!value.startsWith('@craft:')) return;
    if (!craft.requirements.some(item => craftReference(item.key) === value && item.kind === kind && !item.optional)) error(`Declare a required ${kind} requirement for ${value}.`);
  }
  for (const definition of craft.methods) {
    if (definition.kind !== 'preset') continue;
    reference(definition.value.model, 'model');
    if (definition.value.modelReference || definition.value.provider) error('Model connections belong in requirements, not portable agent definitions.');
    definition.value.toolIds.forEach(id => reference(id, 'tool'));
    definition.value.knowledgeCollectionIds.forEach(id => reference(id, 'knowledge'));
    for (const id of definition.value.skillIds) if (!craft.methods.some(item => item.kind === 'skill' && item.value.id === id)) error('Include every skill used by a packaged agent.');
  }
  for (const automation of craft.automations) for (const step of automation.steps) {
    if (step.kind === 'action') reference(step.model, 'model');
    if (step.kind === 'prompt') reference(step.model, 'model');
    if (step.kind === 'tool') reference(step.toolId, 'tool');
    if (step.kind === 'calendar-event') { reference(step.calendarPath, 'calendar'); if (!step.allDay && !step.time) error('Choose a time for the calendar step.'); }
    if (step.kind === 'chat-message') reference(step.conversationPath, 'conversation');
  }
});

export type CraftPackage = z.infer<typeof craftPackageSchema>;
export type CraftResourceKind = z.infer<typeof craftResourceKindSchema>;
export type CraftBindings = Record<string, string>;
export type CraftResource = { id: string; kind: CraftResourceKind; label: string; available: boolean; model?: { providerId: string; modelId: string }; connectionId?: string; effect?: 'read' | 'mutate' };
export type CraftRecord = { package: CraftPackage; bindings: CraftBindings; enabled: boolean };
export type CraftSnapshot = { crafts: CraftRecord[]; resources: CraftResource[]; methods: { id: string; name: string; kind: MethodDefinition['kind'] }[]; automations: { id: string; name: string }[] };
export const craftCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('compose'), id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/), name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(1000), methodIds: z.array(identifier).max(50), automationIds: z.array(identifier).max(20), knowledgeIds: z.array(identifier).max(100).optional() }),
  z.strictObject({ action: z.literal('install'), package: craftPackageSchema, bindings: z.record(z.string(), identifier) }),
  z.strictObject({ action: z.literal('configure'), id: identifier, enabled: z.boolean(), bindings: z.record(z.string(), identifier), confirmed: z.boolean().default(false) }),
  z.strictObject({ action: z.literal('remove'), id: identifier }),
  z.strictObject({ action: z.literal('export'), id: identifier }),
]);
export type CraftCommand = z.infer<typeof craftCommandSchema>;
export const CRAFT_PACKAGE_MAX_BYTES = 1_000_000;
/** Composition Standards that ship with the product: disable only, never remove. */
export const SHIPPED_COMPOSITION_CRAFT_IDS = new Set(['owasp-secure-agent-playbook', 'ngo-playbook']);
export function craftReference(key: string): string { return `@craft:${key}`; }
export function craftComponentId(craftId: string, componentId: string): string { return `craft:${craftId}:${componentId}`; }
export function gyroscopicCraftPackage(): CraftPackage {
  return { format: 'air-office.craft', formatVersion: 1, id: 'gyroscopic-reasoning', version: '0.1.0', name: 'Gyroscopic Reasoning', description: 'A method for persistent human-AI cooperation. It retains closed exchanges (a human contribution, the artificial inference it informs, and the next human contribution) so oversight, correction, and direction remain available as memory and as structured experience for later work.', runtime: 'gyroscopic-reasoning', requirements: [{ key: 'memory-index', kind: 'embedding', label: 'Workspace memory index', suggested: 'workspace.embedding', optional: true }], methods: [], automations: [] };
}
export function humanMarkCraftPackage(skill?: Extract<MethodDefinition, { kind: 'skill' }>): CraftPackage {
  return { format: 'air-office.craft', formatVersion: 1, id: 'the-human-mark', version: '0.1.0', name: 'The Human Mark', description: 'A structural taxonomy of AI safety risks. It classifies failures as displacements of human authority and agency in systems where artificial processes derive from human intelligence, and gives a complete four-risk map rather than a loose list of failure modes.', runtime: 'human-mark', requirements: [], methods: skill ? [{ kind: 'skill', value: { ...skill.value, id: 'the-human-mark' } }] : [], automations: [] };
}
export function parseCraftPackage(text: string): CraftPackage {
  if (new TextEncoder().encode(text).byteLength > CRAFT_PACKAGE_MAX_BYTES) throw new Error('This craft package exceeds the size limit.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Choose a valid craft JSON file.'); }
  const result = craftPackageSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid craft package: ${result.error.issues[0]?.message ?? 'unsupported format'}`);
  return result.data;
}
