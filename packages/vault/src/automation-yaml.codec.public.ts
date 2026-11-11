export type VaultWorkflowStep =
  | { kind: 'prompt'; prompt: string; providerId?: string; modelId?: string; modelReference?: { providerId: string; modelId: string; role: 'chat' | 'background' } }
  | { kind: 'action'; actionPath: string; source: string; instructions: string; providerId: string; modelId: string; definition?: { name: string; system: string; runPrompts: string[] } }
  | { kind: 'tool'; toolId: string; input: Record<string, unknown> }
  | { kind: 'calendar-event'; calendarPath: string; title: string; daysAfterRun: number; allDay: boolean; time?: string }
  | { kind: 'chat-message'; conversationPath: string };

export type VaultAutomationDefinition = {
  schema: 'air.automation/1';
  id: string;
  name: string;
  enabled: boolean;
  missedRunPolicy: 'skip' | 'run-once';
  recurrence: {
    frequency: 'once' | 'daily' | 'weekly';
    interval: number;
    weekdays: number[];
    localTime: string;
    timezone: string;
    startDate: string;
  };
  steps: VaultWorkflowStep[];
  createdAt: string;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validStep(step: unknown): step is VaultWorkflowStep {
  if (!isRecord(step) || typeof step.kind !== 'string') return false;
  switch (step.kind) {
    case 'prompt':
      return typeof step.prompt === 'string' && step.prompt.length <= 20000;
    case 'action':
      return typeof step.actionPath === 'string' && step.actionPath.length > 0
        && typeof step.source === 'string' && step.source.length > 0 && step.source.length <= 200000
        && typeof step.instructions === 'string' && step.instructions.length <= 20000
        && typeof step.providerId === 'string' && typeof step.modelId === 'string';
    case 'tool':
      return typeof step.toolId === 'string' && isRecord(step.input);
    case 'calendar-event':
      return typeof step.calendarPath === 'string' && step.calendarPath.length > 0
        && typeof step.title === 'string' && step.title.trim().length > 0
        && typeof step.daysAfterRun === 'number' && Number.isInteger(step.daysAfterRun)
        && typeof step.allDay === 'boolean'
        && (step.allDay || (typeof step.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(step.time)));
    case 'chat-message':
      return typeof step.conversationPath === 'string' && step.conversationPath.length > 0;
    default:
      return false;
  }
}

export function parseAutomationYaml(bytes: string): VaultAutomationDefinition {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(bytes);
  } catch (error) {
    throw new Error(`Invalid automation YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Automation YAML must be a mapping.');
  if (parsed.schema !== 'air.automation/1') throw new Error('Automation schema must be air.automation/1.');
  if (typeof parsed.id !== 'string' || !parsed.id) throw new Error('Automation id is required.');
  if (typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 120) throw new Error('Automation name is invalid.');
  if (typeof parsed.enabled !== 'boolean') throw new Error('Automation enabled must be boolean.');
  if (parsed.missedRunPolicy !== 'skip' && parsed.missedRunPolicy !== 'run-once') throw new Error('Invalid missedRunPolicy.');
  if (!isRecord(parsed.recurrence)) throw new Error('Automation recurrence is required.');
  if (!Array.isArray(parsed.steps) || parsed.steps.length < 1 || parsed.steps.length > 20 || !parsed.steps.every(validStep)) {
    throw new Error('Automation steps are invalid.');
  }
  const known = new Set(['schema', 'id', 'name', 'enabled', 'missedRunPolicy', 'recurrence', 'steps', 'createdAt', 'updatedAt']);
  const unknown = Object.keys(parsed).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`Automation YAML has undeclared fields: ${unknown.join(', ')}.`);
  return parsed as VaultAutomationDefinition;
}

export function serializeAutomationYaml(definition: VaultAutomationDefinition): string {
  return Bun.YAML.stringify(definition);
}
