import type { Job, JobEvent, JobKind, JobState } from '@office/contracts/job';

export interface StartJobInput {
  id: string;
  kind: JobKind;
  idempotencyKey: string;
}

export interface JobStore {
  /** Creates a job for the key if none exists; returns the existing job when the key repeats. */
  start(input: StartJobInput): { job: Job; created: boolean };
  get(jobId: string): Job | null;
  findByKey(idempotencyKey: string): Job | null;
  list(states?: JobState[]): Job[];
  transition(jobId: string, to: JobState, detail: string | null): Job;
  setProgress(jobId: string, progress: number, checkpoint: string | null): Job;
  events(jobId: string): JobEvent[];
  /** Marks running jobs interrupted on startup, retaining their checkpoints. Idempotent. */
  interrupt(): void;
  clearPersonalData(): void;
  close(): void;
}
