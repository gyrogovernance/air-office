import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteJobStore } from '../../../packages/jobs/src/job-store.adapter';
import { canTransition, resumeAction } from '../../../packages/jobs/src/jobs.domain.public';
import { createJobsService } from '../../../packages/jobs/src/jobs.service.public';

test('the state machine rejects transitions out of a terminal state', () => {
  expect(canTransition('queued', 'running')).toBe(true);
  expect(canTransition('succeeded', 'running')).toBe(false);
  expect(canTransition('cancelled', 'running')).toBe(false);
  expect(canTransition('running', 'interrupted')).toBe(true);
});

test('starting the same unit of work twice returns the existing job', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const store = createSqliteJobStore(join(scratch, 'jobs.sqlite'));
  try {
    const first = store.start({ id: 'j1', kind: 'index-source', idempotencyKey: 'source:v1' });
    const second = store.start({ id: 'j2', kind: 'index-source', idempotencyKey: 'source:v1' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe('j1');
    expect(store.list()).toHaveLength(1);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('an invalid transition throws and does not mutate stored state', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const store = createSqliteJobStore(join(scratch, 'jobs.sqlite'));
  try {
    store.start({ id: 'j1', kind: 'index-source', idempotencyKey: 'k' });
    store.transition('j1', 'running', null);
    store.transition('j1', 'succeeded', null);
    expect(() => store.transition('j1', 'running', null)).toThrow('Invalid job transition');
    expect(store.get('j1')?.state).toBe('succeeded');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('interruption on restart preserves a checkpoint and resume decides from it', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const path = join(scratch, 'jobs.sqlite');
  let store = createSqliteJobStore(path);
  try {
    store.start({ id: 'j1', kind: 'index-source', idempotencyKey: 'k' });
    store.transition('j1', 'running', null);
    store.setProgress('j1', 0.5, 'chunk:42');
    store.close();
    store = createSqliteJobStore(path);
    store.interrupt();
    const job = store.get('j1')!;
    expect(job.state).toBe('interrupted');
    expect(job.checkpoint).toBe('chunk:42');
    expect(resumeAction(job)).toBe('resume');
    store.interrupt();
    expect(store.get('j1')?.state).toBe('interrupted');
    expect(store.events('j1').filter((event) => event.state === 'interrupted')).toHaveLength(1);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a job without a checkpoint restarts, and a terminal job never resumes', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const store = createSqliteJobStore(join(scratch, 'jobs.sqlite'));
  try {
    store.start({ id: 'j1', kind: 'index-source', idempotencyKey: 'k' });
    store.transition('j1', 'running', null);
    store.transition('j1', 'interrupted', null);
    expect(resumeAction(store.get('j1')!)).toBe('restart');
    store.transition('j1', 'running', null);
    store.transition('j1', 'succeeded', null);
    expect(resumeAction(store.get('j1')!)).toBe('none');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('the service runs work under a job and records progress and a terminal state', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const store = createSqliteJobStore(join(scratch, 'jobs.sqlite'));
  try {
    const service = createJobsService(store);
    const { job } = service.start('index-source', 'source:v1');
    const result = await service.run(job.id, async (report) => { report(0.5, 'halfway'); return 'done'; });
    expect(result).toBe('done');
    expect(service.get(job.id)?.state).toBe('succeeded');
    expect(service.get(job.id)?.progress).toBe(0.5);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a failing job records a failed state with the message and does not become succeeded', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-jobs-'));
  const store = createSqliteJobStore(join(scratch, 'jobs.sqlite'));
  try {
    const service = createJobsService(store);
    const { job } = service.start('index-source', 'source:v1');
    await expect(service.run(job.id, async () => { throw new Error('extract failed'); })).rejects.toThrow('extract failed');
    expect(service.get(job.id)?.state).toBe('failed');
    expect(service.get(job.id)?.error).toBe('extract failed');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
