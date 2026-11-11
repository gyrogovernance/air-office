import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobsService, createSqliteJobStore } from '@office/jobs/service';
import { automationRelative } from '@office/vault/domain';
import { createAutomationsService, createVaultAutomationStore } from '../../../packages/automations/src/automations.service.public';
import type { AutomationDefinition } from '../../../packages/automations/src/automations.domain.public';

const scratchPaths: string[] = [];
afterEach(() => { for (const path of scratchPaths.splice(0)) rmSync(path, { recursive: true, force: true }); });

function vault(scratch: string) {
  return createVaultAutomationStore({ vaultRoot: scratch, occurrencesPath: join(scratch, '.air', 'runtime', 'automations.sqlite') });
}

function definition(partial: Omit<AutomationDefinition, 'path'> & { path?: string }): AutomationDefinition {
  return { path: partial.path ?? automationRelative(partial.id), ...partial };
}

describe('automation occurrence processing', () => {
  test('runs the latest missed recurrence after several days offline', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    const executed: string[] = [];
    const service = createAutomationsService(store, jobs, { run: async (_step, _signal, context) => { executed.push(context.occurrence.scheduledAt); return 'done'; } });
    const at = new Date('2026-01-05T12:00:00.000Z');
    const saved = service.save(definition({ id: 'offline-daily', name: 'Daily', enabled: true, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: '2026-01-01' }, missedRunPolicy: 'run-once', steps: [{ kind: 'prompt', prompt: 'Run.' }], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }));
    store.ensureOccurrence(saved.path, '2026-01-02T09:00:00.000Z', '2026-01-01T00:00:00.000Z');
    try {
      await service.tick(at);
      for (let attempt = 0; attempt < 100 && executed.length === 0; attempt++) await Bun.sleep(5);
      expect(executed).toEqual(['2026-01-05T09:00:00.000Z']);
      expect(service.history(saved.path).find((item) => item.scheduledAt === '2026-01-02T09:00:00.000Z')?.state).toBe('skipped');
    } finally { service.close(); jobs.close(); }
  });
  test('runs a paused action twice without enabling its schedule', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    const service = createAutomationsService(store, jobs, { run: async () => 'done' });
    const now = new Date().toISOString();
    const saved = service.save(definition({ id: 'paused-action', name: 'Paused action', enabled: false, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: now.slice(0, 10) }, missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'Run.' }], createdAt: now, updatedAt: now }));
    const runs = await Promise.all([service.runNow(saved.path), service.runNow(saved.path)]);
    for (let attempt = 0; attempt < 100 && service.history(saved.path).filter((item) => item.state === 'succeeded').length < 2; attempt += 1) await Bun.sleep(5);
    expect(new Set(runs.map((run) => run.id)).size).toBe(2);
    expect(service.history(saved.path).filter((item) => item.state === 'succeeded')).toHaveLength(2);
    expect(service.list()[0]?.enabled).toBe(false);
    service.close(); jobs.close();
  });
  test('runs only the latest missed occurrence and retains completed steps after failure', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    let calls = 0;
    const service = createAutomationsService(store, jobs, {
      run: async (step) => {
        calls += 1;
        if (step.kind === 'prompt') return 'first result';
        throw new Error('The second step failed.');
      }
    });
    const now = new Date('2020-01-03T06:00:00.000Z');
    const config = definition({
      id: 'daily-workflow', name: 'Daily workflow', enabled: true,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: '2020-01-01' },
      missedRunPolicy: 'run-once',
      steps: [{ kind: 'prompt', prompt: 'Summarize.' }, { kind: 'tool', toolId: 'fixture:fail', input: {} }],
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    });
    const saved = service.save(config);
    for (const day of ['2020-01-01T07:00:00.000Z', '2020-01-02T07:00:00.000Z']) store.ensureOccurrence(saved.path, day, now.toISOString());

    await service.tick(now);
    for (let attempt = 0; attempt < 100 && !service.history(saved.path).some((item) => item.scheduledAt === '2020-01-02T07:00:00.000Z' && item.state === 'failed'); attempt += 1) await Bun.sleep(5);

    const history = service.history(saved.path);
    expect(history.find((item) => item.scheduledAt === '2020-01-01T07:00:00.000Z')?.state).toBe('skipped');
    const latestMissed = history.find((item) => item.scheduledAt === '2020-01-02T07:00:00.000Z');
    expect(latestMissed?.state).toBe('failed');
    expect(latestMissed?.completedSteps).toEqual([{ step: config.steps[0], result: 'first result' }]);
    expect(latestMissed?.error).toBe('The second step failed.');
    expect(calls).toBe(2);
    service.close();
    jobs.close();
  });

  test('resumes the queued-job crash window and ignores a concurrent duplicate tick', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    let calls = 0;
    const service = createAutomationsService(store, jobs, { run: async () => { calls += 1; return 'done'; } });
    const now = new Date();
    const config = definition({
      id: 'queued-recovery', name: 'Queued recovery', enabled: true,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.toISOString().slice(0, 10) },
      missedRunPolicy: 'run-once', steps: [{ kind: 'prompt', prompt: 'Run once.' }],
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    });
    const saved = service.save(config);
    const occurrence = store.ensureOccurrence(saved.path, new Date(now.getTime() - 60_000).toISOString(), now.toISOString());
    const queuedJob = jobs.start('automation-occurrence', occurrence.id).job;

    await Promise.all([service.tick(now), service.tick(now)]);
    for (let attempt = 0; attempt < 100 && jobs.get(queuedJob.id)?.state !== 'succeeded'; attempt += 1) await Bun.sleep(5);

    expect(jobs.get(queuedJob.id)?.state).toBe('succeeded');
    expect(service.history(saved.path).find((item) => item.id === occurrence.id)?.state).toBe('succeeded');
    expect(calls).toBe(1);
    service.close();
    jobs.close();
  });

  test('marks a run interrupted by restart for review and keeps its completed work', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const now = new Date();
    const config = definition({
      id: 'restart-review', name: 'Restart review', enabled: true,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.toISOString().slice(0, 10) },
      missedRunPolicy: 'run-once', steps: [{ kind: 'prompt', prompt: 'Review.' }],
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    });
    const firstJobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const firstStore = vault(scratch);
    const first = createAutomationsService(firstStore, firstJobs, { run: async () => 'unused' });
    const saved = first.save(config);
    const occurrence = firstStore.ensureOccurrence(saved.path, new Date(now.getTime() - 60_000).toISOString(), now.toISOString());
    const job = firstJobs.start('automation-occurrence', occurrence.id).job;
    firstStore.startOccurrence(occurrence.id, job.id, now.toISOString());
    firstStore.recordOutcome(occurrence.id, 'started', [{ step: config.steps[0]!, result: 'Saved before restart.' }], null, now.toISOString());
    firstJobs.transition(job.id, 'running');
    first.close(); firstJobs.close();

    const nextJobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const nextStore = vault(scratch);
    nextJobs.recover();
    const next = createAutomationsService(nextStore, nextJobs, { run: async () => { throw new Error('Interrupted work must not restart automatically.'); } });
    const recovered = next.history(saved.path).find((item) => item.id === occurrence.id);
    expect(recovered?.state).toBe('failed');
    expect(recovered?.completedSteps).toEqual([{ step: config.steps[0], result: 'Saved before restart.' }]);
    expect(recovered?.error).toContain('AIR Office closed');
    next.close(); nextJobs.close();
  });

  test('cancels an active workflow and records the cancelled occurrence', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    let startedResolve: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    const service = createAutomationsService(store, jobs, { run: async (_step, signal) => new Promise((_resolve, reject) => {
      startedResolve();
      signal.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true });
    }) });
    const now = new Date();
    const saved = service.save(definition({
      id: 'cancel-workflow', name: 'Cancel workflow', enabled: true,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.toISOString().slice(0, 10) },
      missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'Wait.' }],
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    }));
    store.ensureOccurrence(saved.path, now.toISOString(), now.toISOString());
    await service.tick(now);
    await started;
    const occurrence = service.history(saved.path).find((item) => item.state === 'started');
    const jobId = occurrence?.jobId;
    if (!jobId) throw new Error('The running occurrence has no job id.');
    expect(service.cancel(jobId).state).toBe('cancelled');
    expect(service.history(saved.path).find((item) => item.jobId === jobId)?.state).toBe('cancelled');
    service.close(); jobs.close();
  });

  test('save refuses a different automation id at an occupied path', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const store = vault(scratch);
    const now = new Date().toISOString();
    const first = store.save(definition({
      id: 'owner-a', name: 'Owner A', enabled: false, path: 'automations/shared.automation.yaml',
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: now.slice(0, 10) },
      missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'A' }], createdAt: now, updatedAt: now,
    }));
    expect(() => store.save(definition({
      id: 'owner-b', name: 'Owner B', enabled: false, path: first.path,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: now.slice(0, 10) },
      missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'B' }], createdAt: now, updatedAt: now,
    }))).toThrow(/already exists at this path/i);
    expect(store.get('owner-a')?.name).toBe('Owner A');
    expect(store.get('owner-b')).toBeNull();
    store.close();
  });

  test('a step that finishes after cancellation does not mark the occurrence successful', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'air-automation-test-'));
    scratchPaths.push(scratch);
    const jobs = createJobsService(createSqliteJobStore(join(scratch, 'jobs.sqlite')));
    const store = vault(scratch);
    let finish: (result: string) => void = () => undefined;
    const service = createAutomationsService(store, jobs, { run: () => new Promise<string>((resolve) => { finish = resolve; }) });
    const now = new Date();
    const saved = service.save(definition({
      id: 'late-cancel', name: 'Late cancel', enabled: false,
      recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.toISOString().slice(0, 10) },
      missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'Wait.' }],
      createdAt: now.toISOString(), updatedAt: now.toISOString()
    }));
    try {
      await service.runNow(saved.path);
      const jobId = service.history(saved.path).find((item) => item.state === 'started')?.jobId;
      if (!jobId) throw new Error('The running occurrence has no job id.');
      service.cancel(jobId);
      finish('Completed after cancellation');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.history(saved.path).find((item) => item.jobId === jobId)).toMatchObject({ state: 'cancelled', completedSteps: [{ result: 'Completed after cancellation' }] });
    } finally { service.close(); jobs.close(); }
  });
});
