import type { Job, JobKind, JobState } from '@office/contracts/job';
import type { JobStore } from './job-store.port';

export type { Job, JobEvent, JobKind, JobState } from '@office/contracts/job';
export type { JobStore, StartJobInput } from './job-store.port';
export { createSqliteJobStore } from './job-store.adapter';
export { assertTransition, canTransition, isTerminal, newJob, resumeAction, terminalJobStates } from './jobs.domain.public';

export interface JobsService {
  start: (kind: JobKind, idempotencyKey: string) => { job: Job; created: boolean };
  get: (jobId: string) => Job | null;
  list: (states?: JobState[]) => Job[];
  transition: (jobId: string, to: JobState, detail?: string) => Job;
  setProgress: (jobId: string, progress: number, checkpoint?: string | null) => Job;
  /** Runs one unit of work under the job, recording running, progress and a terminal state. Business results stay with the caller. */
  run: <T>(jobId: string, work: (report: (progress: number, checkpoint?: string | null) => void) => Promise<T>) => Promise<T>;
  recover: () => Job[];
  clearPersonalData: () => void;
  close: () => void;
}

/**
 * Application service for jobs. It persists transitions while modules own their
 * business results. `recover` marks interrupted jobs and returns them so the
 * caller can resume from a checkpoint or restart cleanly.
 */
export function createJobsService(store: JobStore): JobsService {
  return {
    start: (kind: JobKind, idempotencyKey: string) => store.start({ id: `${kind}:${idempotencyKey}`, kind, idempotencyKey }),
    get: (jobId: string) => store.get(jobId),
    list: (states?: JobState[]) => store.list(states),
    transition: (jobId: string, to: JobState, detail?: string) => store.transition(jobId, to, detail ?? null),
    setProgress: (jobId: string, progress: number, checkpoint?: string | null) => store.setProgress(jobId, progress, checkpoint ?? null),
    run: async <T>(jobId: string, work: (report: (progress: number, checkpoint?: string | null) => void) => Promise<T>): Promise<T> => {
      const job = store.get(jobId);
      if (!job) throw new Error('Unknown job.');
      if (job.kind === 'download-history') throw new Error('Legacy acquisition history cannot execute. Use Local AI for managed downloads.');
      if (job.state === 'queued' || job.state === 'interrupted' || job.state === 'waiting-user') store.transition(jobId, 'running', null);
      const report = (progress: number, checkpoint?: string | null) => { store.setProgress(jobId, progress, checkpoint ?? null); };
      try {
        const result = await work(report);
        const current = store.get(jobId);
        if (current && !['succeeded', 'failed', 'cancelled'].includes(current.state)) store.transition(jobId, 'succeeded', null);
        return result;
      } catch (error) {
        const current = store.get(jobId);
        if (current && !['succeeded', 'failed', 'cancelled'].includes(current.state)) {
          if ((error as { code?: unknown } | null)?.code === 'cancelled') store.transition(jobId, 'cancelled', 'Cancelled by the operator.');
          else store.transition(jobId, 'failed', error instanceof Error ? error.message : 'Job failed.');
        }
        throw error;
      }
    },
    recover: () => {
      store.interrupt();
      return store.list(['interrupted']);
    },
    clearPersonalData: () => store.clearPersonalData(),
    close: () => store.close()
  };
}
