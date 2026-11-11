/**
 * Durable job contracts. The job engine persists transitions and attempts; the
 * business result stays with the owning module (extraction with documents,
 * indexing with knowledge). A provider or worker timeout never proves the work
 * did not happen, so an unknown outcome is reconciled rather than blindly retried.
 */

export type JobState = 'queued' | 'running' | 'waiting-user' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export type JobKind = 'index-source' | 'rebuild-collection' | 'extract-source' | 'tool-workflow' | 'automation-occurrence' | 'reasoning-memory' | 'download-history';

export interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  /** Stable idempotency key. Starting the same unit twice does not create two jobs. */
  idempotencyKey: string;
  progress: number;
  /** Opaque per-module checkpoint, so an interrupted job can resume where it stopped. */
  checkpoint: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface JobEvent {
  jobId: string;
  sequence: number;
  state: JobState;
  at: string;
  detail: string | null;
}

/** Terminal states never transition further; a finished job is not resurrected. */
export const terminalJobStates: readonly JobState[] = ['succeeded', 'failed', 'cancelled'];

export function isTerminal(state: JobState): boolean {
  return terminalJobStates.includes(state);
}
