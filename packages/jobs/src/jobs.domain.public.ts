import { isTerminal, type Job, type JobKind, type JobState } from '@office/contracts/job';

export type { Job, JobEvent, JobKind, JobState } from '@office/contracts/job';
export { isTerminal, terminalJobStates } from '@office/contracts/job';

/**
 * The allowed transitions form the job state machine. Any transition not listed
 * is rejected, so a terminal job cannot be revived and a cancelled job cannot
 * silently continue. `waiting-user` is a pause for approval, not a failure.
 */
const transitions: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting-user', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  'waiting-user': ['running', 'cancelled', 'failed'],
  interrupted: ['running', 'queued', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: []
};

export function canTransition(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid job transition ${from} -> ${to}`);
}

/**
 * Decides whether an interrupted job may resume from its checkpoint. A job that
 * has a checkpoint resumes from it; a job without one restarts from the queue.
 * A terminal job never resumes.
 */
export function resumeAction(job: Job): 'resume' | 'restart' | 'none' {
  if (job.kind === 'download-history') return 'none';
  if (isTerminal(job.state)) return 'none';
  if (job.state === 'interrupted') return job.checkpoint ? 'resume' : 'restart';
  return 'none';
}

export function newJob(id: string, kind: JobKind, idempotencyKey: string, at = new Date().toISOString()): Job {
  if (!['index-source', 'rebuild-collection', 'extract-source', 'tool-workflow', 'automation-occurrence', 'reasoning-memory'].includes(kind)) throw new Error('This job kind is read-only or unsupported.');
  return { id, kind, state: 'queued', idempotencyKey, progress: 0, checkpoint: null, attempt: 0, createdAt: at, updatedAt: at, error: null };
}
