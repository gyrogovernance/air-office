import { nextOccurrences } from '@office/calendar/domain';
import type { Job, JobsService } from '@office/jobs/service';
import { automationRelative } from '@office/vault/domain';
import type { AutomationDefinition, ScheduledOccurrence, WorkflowStep } from './automations.domain.public';
import { validateAutomation } from './automations.domain.public';
import type { AutomationStore } from './automation-store.port';

export type { AutomationDefinition, MissedRunPolicy, ScheduledOccurrence, WorkflowStep } from './automations.domain.public';
export type { AutomationStore } from './automation-store.port';
export { createVaultAutomationStore } from './automation-store.vault.adapter';

export type AutomationRunContext = { automation: AutomationDefinition; occurrence: ScheduledOccurrence; stepIndex: number; completedSteps: ScheduledOccurrence['completedSteps'] };
export interface AutomationRunner {
  run: (step: WorkflowStep, signal: AbortSignal, context: AutomationRunContext) => Promise<unknown>;
}

export function createAutomationsService(store: AutomationStore, jobs: JobsService, runner: AutomationRunner) {
  const controllers = new Map<string, AbortController>();
  const activeJobs = new Set<string>();
  for (const occurrence of store.history().filter((item) => item.state === 'started')) {
    const jobId = occurrence.jobId;
    if (jobId && jobs.get(jobId)?.state === 'interrupted') store.recordOutcome(occurrence.id, 'failed', occurrence.completedSteps, 'AIR Office closed before this run finished. Review its completed steps before running it again.', new Date().toISOString());
  }
  const startOccurrence = async (occurrence: ScheduledOccurrence, automation: AutomationDefinition): Promise<void> => {
    if (occurrence.state !== 'pending') return;
    const start = jobs.start('automation-occurrence', occurrence.id);
    if (activeJobs.has(start.job.id)) return;
    if (!start.created && start.job.state !== 'queued' && start.job.state !== 'interrupted') return;
    const now = new Date().toISOString();
    const claimed = store.startOccurrence(occurrence.id, start.job.id, now);
    if (claimed.state !== 'started' || claimed.jobId !== start.job.id) return;
    const controller = new AbortController();
    controllers.set(start.job.id, controller);
    activeJobs.add(start.job.id);
    store.recordOutcome(occurrence.id, 'started', [], null, now);
    void jobs.run(start.job.id, async (report) => {
      const completed: { step: WorkflowStep; result: unknown }[] = [];
      try {
        for (const [index, step] of automation.steps.entries()) {
          if (controller.signal.aborted) throw new Error('The workflow was cancelled.');
          report(index / automation.steps.length, `step:${index + 1}`);
          const result = await runner.run(step, controller.signal, { automation, occurrence, stepIndex: index, completedSteps: completed });
          completed.push({ step, result });
          if (controller.signal.aborted) throw new Error('The workflow was cancelled.');
          store.recordOutcome(occurrence.id, 'started', completed, null, new Date().toISOString());
        }
        store.recordOutcome(occurrence.id, 'succeeded', completed, null, new Date().toISOString());
        return completed;
      } catch (error) {
        const cancelled = controller.signal.aborted;
        store.recordOutcome(occurrence.id, cancelled ? 'cancelled' : 'failed', completed, error instanceof Error ? error.message : 'The workflow failed.', new Date().toISOString());
        throw error;
      }
    }).catch(() => undefined).finally(() => { controllers.delete(start.job.id); activeJobs.delete(start.job.id); });
  };
  return {
    list: () => store.list(),
    get: (id: string) => store.get(id),
    getByPath: (path: string) => store.getByPath(path),
    remove: (id: string) => store.remove(id),
    save: (definition: AutomationDefinition) => {
      const candidate = { ...definition, path: definition.path || automationRelative(definition.id) };
      if (!validateAutomation(candidate)) throw new Error('Invalid automation.');
      const previous = store.get(candidate.id);
      if (candidate.enabled && candidate.recurrence.frequency === 'once' && (!previous || JSON.stringify(previous.recurrence) !== JSON.stringify(candidate.recurrence) || !previous.enabled) && nextOccurrences(candidate.recurrence, new Date(), 1).length === 0) throw new Error('Choose a future date and time for a one-time automation.');
      const saved = store.save(candidate);
      const next = nextOccurrences(saved.recurrence, new Date(), 1)[0];
      if (saved.enabled && next) store.ensureOccurrence(saved.path, next.toISOString(), new Date().toISOString());
      return saved;
    },
    history: (automationPath?: string) => store.history(automationPath),
    /** Run a saved automation by vault path (schedule_run tool contract). */
    runNow: async (path: string) => {
      const automation = store.getByPath(path);
      if (!automation) throw new Error('Automation path not found.');
      const occurrence = store.createManualOccurrence(automation.path, new Date().toISOString());
      await startOccurrence(occurrence, automation);
      return occurrence;
    },
    jobs: (states?: Parameters<JobsService['list']>[0]) => jobs.list(states),
    cancel: (jobId: string): Job => {
      const controller = controllers.get(jobId);
      if (!controller) throw new Error('This run is no longer active.');
      controller.abort();
      const cancelled = jobs.transition(jobId, 'cancelled', 'Cancelled by the operator.');
      const occurrence = store.history().find((item) => item.jobId === jobId);
      if (occurrence) store.recordOutcome(occurrence.id, 'cancelled', occurrence.completedSteps, 'Cancelled by the operator.', new Date().toISOString());
      return cancelled;
    },
    tick: async (at = new Date()): Promise<void> => {
      const now = at.toISOString();
      for (const automation of store.list().filter((item) => item.enabled)) {
        let due = store.due(now).filter((occurrence) => occurrence.automationPath === automation.path);
        const missedBefore = new Date(at.getTime() - 30_000).toISOString();
        let missed = due.filter((occurrence) => occurrence.scheduledAt < missedBefore);
        if (automation.missedRunPolicy === 'run-once' && missed.length && automation.recurrence.frequency !== 'once') {
          const periodDays = automation.recurrence.interval * (automation.recurrence.frequency === 'weekly' ? 7 : 1);
          const windowStart = new Date(Date.parse(missedBefore) - (periodDays + 8) * 86_400_000);
          const latest = nextOccurrences(automation.recurrence, windowStart, 32).filter((date) => date.toISOString() < missedBefore).at(-1);
          if (latest && latest.toISOString() > missed.at(-1)!.scheduledAt) {
            store.ensureOccurrence(automation.path, latest.toISOString(), now);
            due = store.due(now).filter((occurrence) => occurrence.automationPath === automation.path);
            missed = due.filter((occurrence) => occurrence.scheduledAt < missedBefore);
          }
        }
        const keep = automation.missedRunPolicy === 'run-once' && missed.length > 0 ? missed.at(-1) : undefined;
        for (const occurrence of due) {
          if (occurrence.scheduledAt < missedBefore && (automation.missedRunPolicy === 'skip' || occurrence.id !== keep?.id)) store.skipOccurrence(occurrence.id, now);
          else await startOccurrence(occurrence, automation);
        }
        const next = nextOccurrences(automation.recurrence, at, 1)[0];
        if (next) store.ensureOccurrence(automation.path, next.toISOString(), now);
      }
    },
    clearPersonalData: () => { for (const controller of controllers.values()) controller.abort(); store.clearPersonalData(); },
    close: () => { for (const controller of controllers.values()) controller.abort(); store.close(); }
  };
}
