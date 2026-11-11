import type { Recurrence } from '@office/calendar/domain';
import { validateRecurrence } from '@office/calendar/domain';

export type MissedRunPolicy = 'skip' | 'run-once';
export type WorkflowStep =
  | { kind: 'prompt'; prompt: string; providerId?: string; modelId?: string; modelReference?: { providerId: string; modelId: string; role: 'chat' | 'background' } }
  | { kind: 'action'; actionPath: string; source: string; instructions: string; providerId: string; modelId: string; definition?: { name: string; system: string; runPrompts: string[] } }
  | { kind: 'tool'; toolId: string; input: Record<string, unknown> }
  | { kind: 'calendar-event'; calendarPath: string; title: string; daysAfterRun: number; allDay: boolean; time?: string }
  | { kind: 'chat-message'; conversationPath: string };
export type AutomationDefinition = {
  id: string;
  /** Vault-relative path such as automations/briefing.automation.yaml. Set by the store on read. */
  path: string;
  name: string;
  enabled: boolean;
  recurrence: Recurrence;
  missedRunPolicy: MissedRunPolicy;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
};
export type ScheduledOccurrence = {
  id: string;
  automationPath: string;
  scheduledAt: string;
  state: 'pending' | 'started' | 'skipped' | 'succeeded' | 'failed' | 'cancelled';
  jobId: string | null;
  updatedAt: string;
  completedSteps: { step: WorkflowStep; result: unknown }[];
  error: string | null;
};

function containsCredentialField(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current)) {
      if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|credential)$/i.test(key)) return true;
      pending.push(child);
    }
  }
  return false;
}

/** Copy only schedule fields; connector credentials stay on the original device. */
export function portableAutomation(definition: AutomationDefinition): AutomationDefinition | null {
  if (definition.steps.some((step) => step.kind === 'tool' && containsCredentialField(step.input))) return null;
  const recurrence = definition.recurrence;
  const steps: WorkflowStep[] = definition.steps.map((step) => {
    switch (step.kind) {
      case 'prompt': return { kind: step.kind, prompt: step.prompt, ...(step.providerId ? { providerId: step.providerId } : {}), ...(step.modelId ? { modelId: step.modelId } : {}), ...(step.modelReference ? { modelReference: { providerId: step.modelReference.providerId, modelId: step.modelReference.modelId, role: step.modelReference.role } } : {}) };
      case 'action': return { kind: step.kind, actionPath: step.actionPath, source: step.source, instructions: step.instructions, providerId: step.providerId, modelId: step.modelId, ...(step.definition ? { definition: { name: step.definition.name, system: step.definition.system, runPrompts: step.definition.runPrompts } } : {}) };
      case 'tool': return { kind: step.kind, toolId: step.toolId, input: step.input };
      case 'calendar-event': return { kind: step.kind, calendarPath: step.calendarPath, title: step.title, daysAfterRun: step.daysAfterRun, allDay: step.allDay, ...(step.time ? { time: step.time } : {}) };
      case 'chat-message': return { kind: step.kind, conversationPath: step.conversationPath };
    }
  });
  return { id: definition.id, path: definition.path, name: definition.name, enabled: definition.enabled, recurrence: { frequency: recurrence.frequency, interval: recurrence.interval, weekdays: recurrence.weekdays, localTime: recurrence.localTime, timezone: recurrence.timezone, startDate: recurrence.startDate }, missedRunPolicy: definition.missedRunPolicy, steps, createdAt: definition.createdAt, updatedAt: definition.updatedAt };
}

export function validateAutomation(value: unknown): value is AutomationDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.enabled !== 'boolean') return false;
  if (typeof item.path !== 'string' || !item.path) return false;
  if (item.missedRunPolicy !== 'skip' && item.missedRunPolicy !== 'run-once') return false;
  if (!validateRecurrence(item.recurrence) || !Array.isArray(item.steps) || item.steps.length < 1 || item.steps.length > 20) return false;
  if (!item.steps.every(validStep)) return false;
  return typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt));
}

function validStep(step: unknown): step is WorkflowStep {
  if (typeof step !== 'object' || step === null) return false;
  if (!('kind' in step)) return false;
  const reference = 'modelReference' in step ? step.modelReference : undefined;
  const referenceRecord = typeof reference === 'object' && reference !== null && !Array.isArray(reference) ? reference as Record<string, unknown> : null;
  switch (step.kind) {
    case 'action': return 'actionPath' in step && typeof step.actionPath === 'string' && step.actionPath.length > 0 && step.actionPath.length <= 400 && 'source' in step && typeof step.source === 'string' && step.source.length > 0 && step.source.length <= 200000 && 'instructions' in step && typeof step.instructions === 'string' && step.instructions.length <= 20000 && 'providerId' in step && typeof step.providerId === 'string' && step.providerId.length > 0 && 'modelId' in step && typeof step.modelId === 'string' && step.modelId.length > 0 && (!('definition' in step) || validActionDefinition(step.definition));
    case 'prompt': return 'prompt' in step && typeof step.prompt === 'string' && step.prompt.length <= 20000 && (!('providerId' in step) || typeof step.providerId === 'string') && (!('modelId' in step) || typeof step.modelId === 'string') && (!referenceRecord || typeof referenceRecord.providerId === 'string' && typeof referenceRecord.modelId === 'string' && (referenceRecord.role === 'chat' || referenceRecord.role === 'background'));
    case 'tool': return 'toolId' in step && typeof step.toolId === 'string' && step.toolId.length <= 200 && 'input' in step && typeof step.input === 'object' && step.input !== null && !Array.isArray(step.input);
    case 'chat-message': return 'conversationPath' in step && typeof step.conversationPath === 'string' && step.conversationPath.length > 0 && step.conversationPath.length <= 400;
    case 'calendar-event': return 'calendarPath' in step && typeof step.calendarPath === 'string' && step.calendarPath.length > 0 && step.calendarPath.length <= 400 && 'title' in step && typeof step.title === 'string' && step.title.trim().length > 0 && step.title.length <= 200 && 'daysAfterRun' in step && typeof step.daysAfterRun === 'number' && Number.isInteger(step.daysAfterRun) && step.daysAfterRun >= 0 && step.daysAfterRun <= 365 && 'allDay' in step && typeof step.allDay === 'boolean' && (step.allDay || ('time' in step && typeof step.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(step.time)));
    default: return false;
  }
}

function validActionDefinition(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('name' in value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || !('system' in value) || typeof value.system !== 'string' || value.system.length > 200000 || !('runPrompts' in value) || !Array.isArray(value.runPrompts) || value.runPrompts.length < 1 || value.runPrompts.length > 12) return false;
  return value.runPrompts.every((prompt: unknown) => typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 200000);
}
