import { describe, expect, test } from 'bun:test';
import type { Job } from '@office/contracts/job';
import { presentKnowledgeIndexJobs, selectKnowledgeIndexJobs } from '../../../apps/web/src/knowledge/knowledge-index-jobs.policy';

function job(partial: Partial<Job> & Pick<Job, 'id' | 'kind' | 'state'>): Job {
  return {
    idempotencyKey: partial.id,
    progress: 0,
    checkpoint: null,
    attempt: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
    error: null,
    ...partial
  };
}

describe('knowledge index job presentation', () => {
  test('hides memory and schedule jobs from Knowledge Indexing', () => {
    const jobs = [
      job({ id: '1', kind: 'reasoning-memory', state: 'failed', error: 'Choose an embedding model.' }),
      job({ id: '2', kind: 'automation-occurrence', state: 'succeeded' }),
      job({ id: '3', kind: 'index-source', state: 'running' })
    ];
    expect(selectKnowledgeIndexJobs(jobs).map((item) => item.id)).toEqual(['3']);
  });

  test('collapses identical finished failures and keeps active jobs separate', () => {
    const jobs = [
      job({ id: 'a', kind: 'index-source', state: 'failed', error: 'offline', updatedAt: '2026-01-01T00:03:00.000Z' }),
      job({ id: 'b', kind: 'index-source', state: 'failed', error: 'offline', updatedAt: '2026-01-01T00:02:00.000Z' }),
      job({ id: 'c', kind: 'rebuild-collection', state: 'running', updatedAt: '2026-01-01T00:04:00.000Z' }),
      job({ id: 'd', kind: 'index-source', state: 'failed', error: 'offline', updatedAt: '2026-01-01T00:01:00.000Z' })
    ];
    const rows = presentKnowledgeIndexJobs(jobs);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: 'Rebuild collection', stateLabel: 'Running', count: 1, cancellable: true });
    expect(rows[1]).toMatchObject({ label: 'Index document', stateLabel: 'Failed', count: 3, error: 'offline', cancellable: false });
  });
});
