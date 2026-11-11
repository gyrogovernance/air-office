import type { Job, JobKind, JobState } from '@office/contracts/job';

/** Job kinds that belong on Settings → Knowledge → Indexing. */
export const KNOWLEDGE_INDEX_JOB_KINDS = new Set<JobKind>([
  'index-source',
  'rebuild-collection',
  'extract-source'
]);

const KIND_LABELS: Record<string, string> = {
  'index-source': 'Index document',
  'rebuild-collection': 'Rebuild collection',
  'extract-source': 'Extract text'
};

const STATE_LABELS: Record<JobState, string> = {
  queued: 'Queued',
  running: 'Running',
  'waiting-user': 'Waiting',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted'
};

export type KnowledgeIndexJobRow = {
  /** Stable row key for React lists. */
  key: string;
  kind: JobKind;
  label: string;
  state: JobState;
  stateLabel: string;
  count: number;
  error: string | null;
  /** Newest underlying job (for cancel). */
  job: Job;
  cancellable: boolean;
};

export function knowledgeIndexJobLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/-/g, ' ');
}

export function knowledgeIndexStateLabel(state: JobState): string {
  return STATE_LABELS[state] ?? state;
}

/**
 * Knowledge Indexing should only show document/collection index work.
 * Memory and schedule jobs are owned elsewhere and must not clutter this list.
 */
export function selectKnowledgeIndexJobs(jobs: readonly Job[]): Job[] {
  return jobs.filter((job) => KNOWLEDGE_INDEX_JOB_KINDS.has(job.kind));
}

/**
 * Collapse identical finished outcomes (especially repeated failures) into one
 * row with a count, while keeping active jobs expanded for cancel.
 */
export function presentKnowledgeIndexJobs(jobs: readonly Job[], limit = 8): KnowledgeIndexJobRow[] {
  const selected = selectKnowledgeIndexJobs(jobs)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const rows: KnowledgeIndexJobRow[] = [];
  const finishedIndex = new Map<string, number>();

  for (const job of selected) {
    const active = ['queued', 'running', 'waiting-user'].includes(job.state);
    if (active) {
      rows.push({
        key: job.id,
        kind: job.kind,
        label: knowledgeIndexJobLabel(job.kind),
        state: job.state,
        stateLabel: knowledgeIndexStateLabel(job.state),
        count: 1,
        error: job.error,
        job,
        cancellable: true
      });
      if (rows.length >= limit) break;
      continue;
    }
    const group = `${job.kind}:${job.state}:${job.error ?? ''}`;
    const existing = finishedIndex.get(group);
    if (existing !== undefined) {
      rows[existing]!.count += 1;
      continue;
    }
    finishedIndex.set(group, rows.length);
    rows.push({
      key: group,
      kind: job.kind,
      label: knowledgeIndexJobLabel(job.kind),
      state: job.state,
      stateLabel: knowledgeIndexStateLabel(job.state),
      count: 1,
      error: job.error,
      job,
      cancellable: false
    });
    if (rows.length >= limit) break;
  }
  return rows;
}
