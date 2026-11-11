import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteJobStore } from '../../../packages/jobs/src/job-store.adapter';
import { createJobsService } from '../../../packages/jobs/src/jobs.service.public';
import { resumeAction } from '../../../packages/jobs/src/jobs.domain.public';

test('legacy active rows migrate once with original identity, progress, checkpoint and files preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'air-retirement-'));
  const path = join(root, 'jobs.sqlite');
  const initial = createSqliteJobStore(path); initial.close();
  const checkpoint = JSON.stringify({ offset: 7, tempPath: join(root, 'model.part'), etag: 'revision' });
  await writeFile(join(root, 'model.part'), 'partial');
  const db = new Database(path);
  for (const [index, state] of ['queued', 'running', 'waiting-user', 'interrupted', 'succeeded', 'cancelled', 'failed'].entries()) {
    db.query('INSERT INTO job_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`legacy-${index}`, index % 2 ? 'acquire-engine' : 'acquire-model', state, `key-${index}`, .25, checkpoint, 2, '2026-01-01', '2026-01-01', state === 'failed' ? 'original failure' : null);
    db.query('INSERT INTO job_events VALUES (?, 0, ?, ?, ?)').run(`legacy-${index}`, state, '2026-01-01', 'original event');
  }
  db.close();
  let store = createSqliteJobStore(path);
  try {
    for (let index = 0; index < 4; index++) {
      const job = store.get(`legacy-${index}`)!;
      expect(job).toMatchObject({ kind: 'download-history', state: 'interrupted', checkpoint, progress: .25, attempt: 2, idempotencyKey: `key-${index}`, createdAt: '2026-01-01' });
      expect(job.error).toContain('outcome is unverified');
      expect(resumeAction(job)).toBe('none');
      expect(store.events(job.id)).toHaveLength(1);
      expect(store.events(job.id)[0]?.detail).toBe('original event');
    }
    expect(store.get('legacy-4')?.state).toBe('succeeded');
    expect(store.get('legacy-5')?.state).toBe('cancelled');
    expect(store.get('legacy-6')?.error).toBe('original failure');
    expect(await readFile(join(root, 'model.part'), 'utf8')).toBe('partial');
    let ran = false;
    const jobs = createJobsService(store);
    await expect(jobs.run('legacy-0', async () => { ran = true; })).rejects.toThrow('cannot execute');
    expect(ran).toBe(false);
    expect(() => store.transition('legacy-0', 'running', null)).toThrow('read-only');
    expect(() => store.setProgress('legacy-0', 1, 'overwrite')).toThrow('read-only');
    expect(store.get('legacy-0')?.checkpoint).toBe(checkpoint);
    store.close(); store = createSqliteJobStore(path);
    expect(store.events('legacy-0')).toHaveLength(1);
    const generic = createJobsService(store);
    const started = generic.start('index-source', 'normal');
    await generic.run(started.job.id, async (report) => { report(.5, 'generic checkpoint'); });
    expect(generic.get(started.job.id)?.state).toBe('succeeded');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
