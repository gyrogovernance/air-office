import type { AutomationDefinition, ScheduledOccurrence } from './automations.domain.public';

export interface AutomationStore {
  list(): AutomationDefinition[];
  get(id: string): AutomationDefinition | null;
  getByPath(path: string): AutomationDefinition | null;
  save(definition: AutomationDefinition): AutomationDefinition;
  remove(id: string): void;
  due(now: string): ScheduledOccurrence[];
  ensureOccurrence(automationPath: string, scheduledAt: string, at: string): ScheduledOccurrence;
  createManualOccurrence(automationPath: string, at: string): ScheduledOccurrence;
  startOccurrence(id: string, jobId: string, at: string): ScheduledOccurrence;
  skipOccurrence(id: string, at: string): ScheduledOccurrence;
  recordOutcome(id: string, state: 'started' | 'succeeded' | 'failed' | 'cancelled', completedSteps: { step: import('./automations.domain.public').WorkflowStep; result: unknown }[], error: string | null, at: string): ScheduledOccurrence;
  history(automationPath?: string, limit?: number): ScheduledOccurrence[];
  clearPersonalData(): void;
  close(): void;
}
