import type { AutomationDefinition, WorkflowStep } from '@office/automations/domain';
import { automationRelative } from '@office/vault/domain';
import type { MethodDefinition } from './methods.domain.public';
import { craftComponentId, craftReference, craftPackageSchema, gyroscopicCraftPackage, humanMarkCraftPackage, SHIPPED_COMPOSITION_CRAFT_IDS } from './craft-package.policy';
import type { CraftPackage, CraftRecord, CraftResource, CraftBindings, CraftSnapshot, CraftCommand, CraftResourceKind } from './craft-package.policy';

export { SHIPPED_COMPOSITION_CRAFT_IDS };

interface CraftPorts {
  store: { list(): CraftRecord[]; save(record: CraftRecord): CraftRecord; remove(id: string): unknown };
  methods: { list(): MethodDefinition[]; get(id: string): MethodDefinition | null; save(value: MethodDefinition): MethodDefinition; remove(id: string): unknown };
  automations: { list(): AutomationDefinition[]; save(value: AutomationDefinition): AutomationDefinition; remove(id: string): unknown };
  action(id: string): { name: string; system: string; runPrompts: string[] } | null;
  resources(): CraftResource[];
  validateAutomation(value: AutomationDefinition, confirmed: boolean): void;
  memoryEnabled(): boolean;
  setMemoryEnabled(enabled: boolean): void;
  hasHumanMarkSkill(): boolean;
  humanMarkEnabled(): boolean;
  /** Optional composition Standards seeded Off (for example OWASP Secure Agent Playbook). */
  bundledCompositionCrafts?: () => CraftPackage[];
}

export function createCraftService(ports: CraftPorts) {
  function records(): CraftRecord[] {
    const saved = ports.store.list();
    const skill = ports.methods.get('lab-skill-the-human-mark');
    const humanMark = humanMarkCraftPackage(skill?.kind === 'skill' ? skill : undefined);
    for (const craft of [gyroscopicCraftPackage(), humanMark]) if (!saved.some(item => item.package.id === craft.id)) saved.push(ports.store.save({ package: craft, bindings: {}, enabled: true }));
    for (const craft of ports.bundledCompositionCrafts?.() ?? []) {
      const existing = saved.find(item => item.package.id === craft.id);
      if (!existing) saved.push(ports.store.save({ package: craft, bindings: {}, enabled: false }));
      else if (JSON.stringify(existing.package) !== JSON.stringify(craft)) {
        const index = saved.indexOf(existing);
        saved[index] = ports.store.save({ ...existing, package: craft });
      }
    }
    return saved.map(item => item.package.runtime === 'gyroscopic-reasoning' ? { ...item, enabled: ports.memoryEnabled() } : item.package.runtime === 'human-mark' ? { ...item, enabled: ports.humanMarkEnabled() } : item);
  }
  function snapshot(): CraftSnapshot {
    return { crafts: records(), resources: ports.resources(), methods: ports.methods.list().filter(item => !item.value.id.startsWith('craft:')).map(item => ({ id: item.value.id, name: item.value.name, kind: item.kind })), automations: ports.automations.list().filter(item => !item.id.startsWith('craft:')).map(item => ({ id: item.id, name: item.name })) };
  }
  function compose(command: Extract<CraftCommand, { action: 'compose' }>): CraftPackage {
    const requirements: CraftPackage['requirements'] = [];
    const resources = ports.resources();
    function ref(kind: CraftResourceKind, id: string): string {
      const existing = requirements.find(item => item.kind === kind && item.suggested === id);
      if (existing) return craftReference(existing.key);
      const resource = resources.find(item => item.kind === kind && item.id === id);
      if (!resource) throw new Error(`Choose an available ${kind} before packaging this component.`);
      let connection: string | undefined;
      if (kind === 'tool' && resource.connectionId && resources.some(item => item.kind === 'mcp' && item.id === resource.connectionId)) connection = ref('mcp', resource.connectionId).slice('@craft:'.length);
      const key = `resource-${requirements.length + 1}`;
      requirements.push({ key, kind, label: resource.label, suggested: id, optional: false, ...(connection ? { connection } : {}) });
      return craftReference(key);
    }
    for (const id of command.knowledgeIds ?? []) ref('knowledge', id);
    const allMethods = ports.methods.list();
    const chosen = new Set(command.methodIds);
    for (const id of chosen) {
      const definition = allMethods.find(item => item.value.id === id);
      if (!definition) throw new Error('A selected method no longer exists.');
      if (definition.kind === 'preset') definition.value.skillIds.forEach(skill => chosen.add(skill));
    }
    const methods = [...chosen].map((id): MethodDefinition => {
      const definition = allMethods.find(item => item.value.id === id);
      if (!definition) throw new Error('Include the missing skill before packaging this agent.');
      if (definition.kind !== 'preset') return definition;
      const { provider: _provider, modelReference: _reference, ...value } = definition.value;
      const providerId = definition.value.modelReference?.providerId ?? definition.value.provider;
      const modelId = definition.value.modelReference?.modelId ?? definition.value.model;
      return { kind: 'preset', value: { ...value, model: ref('model', JSON.stringify([providerId, modelId])), toolIds: value.toolIds.map(id => ref('tool', id)), knowledgeCollectionIds: value.knowledgeCollectionIds.map(id => ref('knowledge', id)) } };
    });
    const automations = command.automationIds.map(id => {
      const item = ports.automations.list().find(value => value.id === id);
      if (!item) throw new Error('A selected automation no longer exists.');
      const steps: CraftPackage['automations'][number]['steps'] = item.steps.map(step => {
        if (step.kind === 'action') {
          const definition = step.definition ?? ports.action(step.actionPath);
          if (!definition) throw new Error('An action used by this schedule is no longer available.');
          return { kind: 'action', actionPath: step.actionPath, source: step.source, instructions: step.instructions, definition, model: ref('model', JSON.stringify([step.providerId, step.modelId])) };
        }
        if (step.kind === 'prompt') return { kind: 'prompt', prompt: step.prompt, model: ref('model', JSON.stringify([step.modelReference?.providerId ?? step.providerId, step.modelReference?.modelId ?? step.modelId])) };
        if (step.kind === 'tool') return { kind: 'tool', toolId: ref('tool', step.toolId), input: step.input };
        if (step.kind === 'calendar-event') return { ...step, calendarPath: ref('calendar', step.calendarPath) };
        return { ...step, conversationPath: ref('conversation', step.conversationPath) };
      });
      return { id: item.id, name: item.name, recurrence: item.recurrence, missedRunPolicy: item.missedRunPolicy, steps };
    });
    return craftPackageSchema.parse({ format: 'air-office.craft', formatVersion: 1, id: command.id, name: command.name, description: command.description, version: '0.1.0', runtime: 'composition', requirements, methods, automations });
  }
  function resolve(craft: CraftPackage, bindings: CraftBindings) {
    const resources = ports.resources();
    const selected = new Map<string, CraftResource>();
    for (const requirement of craft.requirements) {
      const resource = resources.find(item => item.kind === requirement.kind && item.id === bindings[requirement.key] && item.available);
      if (!resource && !requirement.optional) throw new Error(`Configure ${requirement.label} before enabling this craft.`);
      if (resource) selected.set(craftReference(requirement.key), resource);
    }
    for (const requirement of craft.requirements) if (requirement.connection) {
      const tool = selected.get(craftReference(requirement.key));
      const connection = selected.get(craftReference(requirement.connection));
      if (!tool || !connection || tool.connectionId !== connection.id) throw new Error(`Choose ${requirement.label} from the selected MCP connection.`);
    }
    const resource = (reference: string) => { const value = selected.get(reference); if (!value) throw new Error('A craft component has an unresolved requirement.'); return value; };
    const model = (reference: string) => {
      if (!reference.startsWith('@craft:')) return { providerId: 'unassigned', modelId: reference };
      const value = resource(reference).model;
      if (!value) throw new Error('Choose a model for this requirement.');
      return value;
    };
    const methods: MethodDefinition[] = craft.methods.map(definition => {
      const value = { ...definition.value, id: craftComponentId(craft.id, definition.value.id) };
      if (definition.kind === 'preset') {
        const toolIds = definition.value.toolIds.map(id => resource(id).id);
        const knowledgeCollectionIds = definition.value.knowledgeCollectionIds.map(id => resource(id).id);
        const skillIds = definition.value.skillIds.map(id => craftComponentId(craft.id, id));
        if (!definition.value.model.startsWith('@craft:')) {
          return { kind: 'preset', value: { ...definition.value, id: value.id, model: definition.value.model, toolIds, knowledgeCollectionIds, skillIds } };
        }
        const chosen = model(definition.value.model);
        return { kind: 'preset', value: { ...definition.value, id: value.id, provider: chosen.providerId, model: chosen.modelId, modelReference: { ...chosen, role: 'chat' }, toolIds, knowledgeCollectionIds, skillIds } };
      }
      if (definition.kind === 'skill') return { kind: 'skill', value: { ...definition.value, id: craft.runtime === 'human-mark' ? 'lab-skill-the-human-mark' : value.id } };
      return { kind: 'prompt', value: { ...definition.value, id: value.id } };
    });
    const now = new Date().toISOString();
    // Craft Actions land paused. Enabling a playbook must not flood the calendar
    // with live schedules; the operator turns each one on after review.
    const automations: AutomationDefinition[] = craft.automations.map(item => {
      const id = craftComponentId(craft.id, item.id);
      return {
        id,
        path: automationRelative(id),
        name: item.name,
        enabled: false,
        recurrence: item.recurrence,
        missedRunPolicy: item.missedRunPolicy,
        createdAt: now,
        updatedAt: now,
        steps: item.steps.map((step): WorkflowStep => {
          if (step.kind === 'action') { const chosen = model(step.model); return { kind: 'action', actionPath: step.actionPath, source: step.source, instructions: step.instructions, definition: step.definition, providerId: chosen.providerId, modelId: chosen.modelId }; }
          if (step.kind === 'prompt') { const chosen = model(step.model); return { kind: 'prompt', prompt: step.prompt, providerId: chosen.providerId, modelId: chosen.modelId, modelReference: { ...chosen, role: 'background' } }; }
          if (step.kind === 'tool') return { ...step, toolId: resource(step.toolId).id };
          if (step.kind === 'calendar-event') return { ...step, calendarPath: resource(step.calendarPath).id };
          return { ...step, conversationPath: resource(step.conversationPath).id };
        }),
      };
    });
    return { methods, automations };
  }
  function configure(command: Extract<CraftCommand, { action: 'configure' }>): CraftRecord {
    const record = records().find(item => item.package.id === command.id);
    if (!record) throw new Error('This craft is not installed.');
    if (!command.enabled) {
      for (const item of record.package.automations) {
        const existing = ports.automations.list().find(value => value.id === craftComponentId(record.package.id, item.id));
        if (existing) ports.automations.save({ ...existing, enabled: false });
      }
      if (record.package.runtime === 'gyroscopic-reasoning') ports.setMemoryEnabled(false);
      return ports.store.save({ ...record, enabled: false });
    }
    const resolved = resolve(record.package, command.bindings);
    if (record.package.runtime === 'human-mark' && !ports.hasHumanMarkSkill() && !resolved.methods.some(item => item.kind === 'skill')) throw new Error('The Human Mark skill is not installed in this workspace.');
    resolved.automations.forEach(item => ports.validateAutomation(item, command.confirmed));
    const previousMethods = ports.methods.list();
    const previousAutomations = ports.automations.list();
    const rebound = record.package.requirements.some(item => record.bindings[item.key] !== command.bindings[item.key]);
    const effectiveMethods = resolved.methods.map((definition): MethodDefinition => {
      const existing = previousMethods.find(item => item.value.id === definition.value.id);
      if (!existing) return definition;
      if (existing.kind !== definition.kind) throw new Error('An installed craft component changed kind. Resolve that conflict before enabling.');
      if (!rebound || existing.kind !== 'preset' || definition.kind !== 'preset') return existing;
      return { kind: 'preset', value: { ...existing.value, provider: definition.value.provider, model: definition.value.model, modelReference: definition.value.modelReference, toolIds: definition.value.toolIds, knowledgeCollectionIds: definition.value.knowledgeCollectionIds } };
    });
    const effectiveAutomations = resolved.automations.map(definition => {
      const existing = previousAutomations.find(item => item.id === definition.id);
      if (!existing) return definition;
      // Keep the operator's On/Off choice when re-enabling or rebinding the craft.
      if (!rebound) return existing;
      if (existing.steps.length !== definition.steps.length) throw new Error('Automation steps changed. Package the edited automation as a new craft before rebinding it.');
      const steps = existing.steps.map((step, index): WorkflowStep => {
        const next = definition.steps[index];
        if (!next || next.kind !== step.kind) throw new Error('Automation steps changed. Package the edited automation as a new craft before rebinding it.');
        if (step.kind === 'prompt' && next.kind === 'prompt') return { ...step, providerId: next.providerId, modelId: next.modelId, modelReference: next.modelReference };
        if (step.kind === 'action' && next.kind === 'action') return { ...step, providerId: next.providerId, modelId: next.modelId };
        if (step.kind === 'tool' && next.kind === 'tool') return { ...step, toolId: next.toolId };
        if (step.kind === 'calendar-event' && next.kind === 'calendar-event') return { ...step, calendarPath: next.calendarPath };
        if (step.kind === 'chat-message' && next.kind === 'chat-message') return { ...step, conversationPath: next.conversationPath };
        return step;
      });
      return { ...existing, steps };
    });
    effectiveAutomations.forEach(item => ports.validateAutomation(item, command.confirmed));
    const addedMethods: string[] = [];
    const addedAutomations: string[] = [];
    try {
      for (const definition of effectiveMethods) {
        if (previousMethods.find(item => item.value.id === definition.value.id) !== definition) { ports.methods.save(definition); addedMethods.push(definition.value.id); }
      }
      for (const definition of effectiveAutomations) {
        ports.automations.save(definition);
        addedAutomations.push(definition.id);
      }
      if (record.package.runtime === 'gyroscopic-reasoning') ports.setMemoryEnabled(true);
      return ports.store.save({ ...record, bindings: command.bindings, enabled: true });
    } catch (error) {
      for (const id of addedMethods) { const previous = previousMethods.find(item => item.value.id === id); if (previous) ports.methods.save(previous); else ports.methods.remove(id); }
      for (const id of addedAutomations) { const previous = previousAutomations.find(item => item.id === id); if (previous) ports.automations.save(previous); else ports.automations.remove(id); }
      throw error;
    }
  }
  function execute(command: CraftCommand): CraftPackage | CraftRecord | null {
    if (command.action === 'compose') return compose(command);
    if (command.action === 'configure') return configure(command);
    if (command.action === 'export') {
      const record = records().find(item => item.package.id === command.id);
      if (!record) throw new Error('This craft is not installed.');
      if (record.package.runtime === 'gyroscopic-reasoning') return record.package;
      if (record.package.runtime === 'human-mark') {
        const skill = ports.methods.get('lab-skill-the-human-mark');
        if (!skill || skill.kind !== 'skill') throw new Error('Install The Human Mark skill before exporting its craft.');
        return { ...record.package, methods: humanMarkCraftPackage(skill).methods };
      }
      const methodIds = record.package.methods.map(item => craftComponentId(command.id, item.value.id));
      const automationIds = record.package.automations.map(item => craftComponentId(command.id, item.id));
      const installed = methodIds.some(id => ports.methods.list().some(item => item.value.id === id)) || automationIds.some(id => ports.automations.list().some(item => item.id === id));
      if (!installed) return record.package;
      const knowledgeIds = record.package.requirements.filter(item => item.kind === 'knowledge').flatMap(item => { const id = record.bindings[item.key]; return id ? [id] : []; });
      const current = compose({ action: 'compose', id: command.id, name: record.package.name, description: record.package.description, methodIds, automationIds, knowledgeIds });
      const prefix = `craft:${command.id}:`;
      const originalId = (id: string) => id.startsWith(prefix) ? id.slice(prefix.length) : id;
      return { ...current, version: record.package.version, methods: current.methods.map((item): MethodDefinition => item.kind === 'preset' ? { kind: 'preset', value: { ...item.value, id: originalId(item.value.id), skillIds: item.value.skillIds.map(originalId) } } : item.kind === 'skill' ? { kind: 'skill', value: { ...item.value, id: originalId(item.value.id) } } : { kind: 'prompt', value: { ...item.value, id: originalId(item.value.id) } }), automations: current.automations.map(item => ({ ...item, id: originalId(item.id) })) };
    }
    if (command.action === 'install') {
      const existing = records().find(item => item.package.id === command.package.id);
      if (existing) {
        if (JSON.stringify(existing.package) === JSON.stringify(command.package)) return existing;
        if (command.package.runtime === 'human-mark') {
          const imported = command.package.methods[0];
          if (command.package.methods.length !== 1 || imported?.kind !== 'skill' || command.package.automations.length || command.package.requirements.length) throw new Error('The Human Mark package requires exactly one skill.');
          const previous = ports.methods.get('lab-skill-the-human-mark');
          ports.methods.save({ kind: 'skill', value: { ...imported.value, id: 'lab-skill-the-human-mark' } });
          try { return ports.store.save({ package: command.package, bindings: command.bindings, enabled: false }); }
          catch (error) { if (previous) ports.methods.save(previous); else ports.methods.remove('lab-skill-the-human-mark'); throw error; }
        }
        throw new Error('A different package already uses this craft ID. Choose a new ID.');
      }
      if (ports.methods.list().some(item => item.value.id.startsWith(`craft:${command.package.id}:`)) || ports.automations.list().some(item => item.id.startsWith(`craft:${command.package.id}:`))) throw new Error('Components from this craft ID already exist. Choose a new package ID to preserve them.');
      return ports.store.save({ package: command.package, bindings: command.bindings, enabled: false });
    }
    const record = records().find(item => item.package.id === command.id);
    if (!record) return null;
    if (record.package.runtime === 'gyroscopic-reasoning') throw new Error('The built-in craft can be disabled but not removed.');
    if (record.package.runtime === 'human-mark') throw new Error('The built-in craft can be disabled but not removed.');
    if (SHIPPED_COMPOSITION_CRAFT_IDS.has(record.package.id)) throw new Error('Shipped Standards can be disabled but not removed.');
    if (record.enabled) throw new Error('Disable this craft before removing it.');
    ports.store.remove(command.id);
    return null;
  }
  records();
  return { snapshot, execute, humanMarkInstructions: () => {
    if (!ports.humanMarkEnabled()) return '';
    const skill = ports.methods.get('lab-skill-the-human-mark');
    if (!skill || skill.kind !== 'skill') return '';
    return skill.value.instructions;
  } };
}
