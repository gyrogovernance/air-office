import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLemonadeActivityJournal } from '../../../apps/service/src/lemonade-activity.adapter';
import { createLemonadeActivityRoutes } from '../../../apps/service/src/lemonade-activity.route';

const identity = { instanceId: 'fixture', generation: 1 };
const job = (status = 'downloading', running = true, id = 'model:small') => ({ id, type: 'model', model_name: 'small', status, running, percent: 35, file: 'C:/private/model.gguf', error: 'credential-secret', bytes_downloaded: 123 });

test('reconnect deduplicates observations, same-generation reopen reconciles without claiming success', () => {
  const root = mkdtempSync(join(tmpdir(), 'air-activity-')); const path = join(root, 'history.sqlite');
  let journal = createLemonadeActivityJournal(path, identity);
  try {
    journal.observe([job()], true); journal.observe([job()], true);
    const id = journal.list()[0]!.id;
    expect(journal.list()).toHaveLength(1);
    journal.close(); journal = createLemonadeActivityJournal(path, identity);
    expect(journal.list()[0]).toMatchObject({ id, state: 'interrupted', running: null });
    journal.observe([job()], true);
    expect(journal.list()[0]).toMatchObject({ id, state: 'downloading' });
    journal.observe([], true); expect(journal.list()[0]!.state).toBe('unknown');
    journal.observe([job('completed', true)], true); expect(journal.list()[0]!.state).toBe('downloading');
    journal.observe([job('completed', false)], true); journal.observe([], true);
    expect(journal.list()[0]!.state).toBe('completed');
    expect(JSON.stringify(journal.list())).not.toMatch(/private|secret|bytes_downloaded|file/);
  } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
});

test('new generation or instance never merges reused upstream IDs and retains terminal outcomes', () => {
  const root = mkdtempSync(join(tmpdir(), 'air-activity-')); const path = join(root, 'history.sqlite');
  let journal = createLemonadeActivityJournal(path, identity);
  try {
    journal.observe([job(), job('completed', false, 'model:done')], true); journal.close();
    journal = createLemonadeActivityJournal(path, { ...identity, generation: 2 });
    journal.observe([job('completed', false)], true);
    expect(journal.list()).toHaveLength(3);
    expect(journal.list().find((row) => row.jobId === 'model:small' && row.generation === 1)?.state).toBe('interrupted');
    expect(journal.list().find((row) => row.jobId === 'model:done')?.state).toBe('completed');
    journal.close(); journal = createLemonadeActivityJournal(path, { instanceId: 'other', generation: 2 });
    journal.observe([job()], true);
    journal.close(); journal = createLemonadeActivityJournal(path, identity);
    expect(journal.list().find((row) => row.instanceId === 'other' && row.jobId === 'model:small')?.state).toBe('interrupted');
    journal.observe([job()], true);
    expect(journal.list()).toHaveLength(4);
  } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
});

test('bounded retention preserves terminal rows after removal and records retries separately', () => {
  const journal = createLemonadeActivityJournal(':memory:', identity, 3);
  try {
    journal.observe(job('completed', false)); journal.observe(job());
    expect(journal.list()).toHaveLength(2);
    journal.observe(job('cancelled', false)); journal.control('model:small', 'remove'); journal.observe([], true);
    expect(journal.list()[0]).toMatchObject({ state: 'cancelled', lastAction: 'remove' });
    journal.observe(job('error', false, 'model:two')); journal.observe(job('completed', false, 'model:three'));
    expect(journal.list()).toHaveLength(3);
    journal.observe({ ...job(), id: 'C:/private/file' }); expect(journal.list()).toHaveLength(3);
  } finally { journal.close(); }
});

test('operation wrapper retains upstream responses, observes only successful results and serves uncached history', async () => {
  const journal = createLemonadeActivityJournal(':memory:', identity);
  const descriptor = { ...identity, release: '2026.42.1', baseOrigin: 'http://runtime.test', resolveSecret: () => 'secret' };
  let result: unknown = job(); let status = 200; const calls: unknown[] = [];
  const route = createLemonadeActivityRoutes(descriptor, journal, async (request) => { calls.push(await request.json()); return Response.json({ result }, { status }); });
  const url = new URL('http://air.test/api/v1/local-ai/operations');
  const post = (operation: string, input?: unknown) => route(new Request(url, { method: 'POST', body: JSON.stringify({ operation, input }) }), url);
  try {
    expect(await (await post('pull'))!.json()).toEqual({ result: job() });
    result = [job('paused', false)]; await post('downloads');
    result = { status: 'ok' }; await post('download-control', { id: 'model:small', action: 'remove' });
    expect(journal.list()[0]).toMatchObject({ state: 'paused', lastAction: 'remove' });
    status = 502; result = job('completed', false); await post('pull'); expect(journal.list()[0]!.state).toBe('paused');
    status = 200; result = [job('paused', false)];
    const historyUrl = new URL('http://air.test/api/v1/local-ai/download-history');
    const response = await route(new Request(historyUrl), historyUrl);
    expect(response!.headers.get('cache-control')).toBe('no-store');
    expect(await response!.json()).toMatchObject({ current: identity, activities: [{ state: 'paused' }] });
    expect(calls.at(-1)).toEqual({ operation: 'downloads' });
    expect(calls).toHaveLength(5);
    status = 401;
    const failedHistory = await route(new Request(historyUrl), historyUrl);
    expect(failedHistory?.status).toBe(401);
    expect(await failedHistory?.json()).toMatchObject({ result: [{ id: 'model:small', status: 'paused' }] });
    expect(calls).toHaveLength(6);
    const missing = createLemonadeActivityRoutes(descriptor, journal, async () => null);
    const unavailable = await missing(new Request(historyUrl), historyUrl);
    const unavailableText = await unavailable?.text();
    expect(unavailable?.status).toBe(502);
    expect(unavailableText).toBe('Download history is unavailable.');
    expect(unavailableText).not.toMatch(/Lemonade|lemond/i);
  } finally { journal.close(); }
});
