import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchService, stopService, type LaunchedService } from '../../support/service-launch.adapter';

test('Knowledge selection PUT changes actual embedding requests and persists across service restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'air-knowledge-route-'));
  let failRerank = false;
  let rerankCalls = 0;
  const requests: { model: string; input: string[] }[] = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/v1/rerank') {
      rerankCalls++;
      if (failRerank) return Response.json({ error: 'private-upstream' }, { status: 500 });
      const body = await request.json() as { documents: string[] };
      return Response.json({ object: 'list', model: 'rank:one', results: body.documents.map((_, index) => ({ index, relevance_score: index })) });
    }
    if (new URL(request.url).pathname === '/v1/embeddings') {
      const body = await request.json() as { model: string; input: string[] };
      requests.push(body);
      return Response.json({ object: 'list', model: body.model, data: body.input.map((_, index) => ({ object: 'embedding', index, embedding: [1, 0] })) });
    }
    if (new URL(request.url).pathname === '/v1/models') return Response.json({ object: 'list', data: [{ id: 'embed:one', labels: ['embeddings'] }, { id: 'embed:two', labels: ['embeddings'] }, { id: 'rank:one', labels: ['reranking'] }] });
    return new Response('Not found', { status: 404 });
  } });
  let service: LaunchedService | undefined;
  const env = {
    OFFICE_RUNTIME_DIR: join(dir, 'runtime'), OFFICE_KNOWLEDGE_DATABASE_PATH: join(dir, 'knowledge.sqlite'),
    OFFICE_LAB_PACK: 'false', OFFICE_EXTRACTION_WORKER: 'false',
    OFFICE_LEMONADE_BASE_ORIGIN: `http://127.0.0.1:${upstream.port}`, OFFICE_LEMONADE_TOKEN: 'fixture-key',
    OFFICE_LEMONADE_INSTANCE_ID: 'knowledge-test', OFFICE_LEMONADE_GENERATION: '1', OFFICE_LEMONADE_RELEASE: '2026.42.1',
    OFFICE_LEMONADE_EMBEDDING_MODEL: '', OFFICE_LEMONADE_EMBEDDING_REVISION: '', OFFICE_KNOWLEDGE_EMBEDDING_MODE: 'runtime', NODE_ENV: 'production'
  };
  const call = (path: string, method = 'GET', body?: unknown) => fetch(`${service!.base}${path}`, { method, headers: { authorization: `Bearer ${service!.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    service = await launchService({ env });
    expect((await call('/api/v1/knowledge/embedding-model')).status).toBe(200);
    expect((await call('/api/v1/knowledge/embedding-model', 'PUT', { model: 'embed:one', dimensions: 2 })).status).toBe(400);
    const selected = { model: 'embed:one', revision: 'recipe-1', dimensions: 2 };
    const put = await call('/api/v1/knowledge/embedding-model', 'PUT', selected);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject(selected);
    expect((await call('/api/v1/local-ai/power', 'PUT', { enabled: true })).status).toBe(200);
    expect(await (await call('/api/v1/knowledge/embedding-probe', 'POST', { model: selected.model })).json()).toEqual({ model: selected.model, dimensions: 2 });
    await call('/api/v1/collections', 'POST', { id: 'c', name: 'Knowledge' });
    const search = await call('/api/v1/search', 'POST', { collectionIds: ['c'], query: 'test', mode: 'vector' });
    expect(search.status).toBe(200);
    expect(requests.at(-1)).toEqual({ model: 'embed:one', input: ['test'] });
    const next = { ...selected, model: 'embed:two', revision: 'recipe-2' };
    expect((await call('/api/v1/knowledge/embedding-model', 'PUT', next)).status).toBe(200);
    await call('/api/v1/search', 'POST', { collectionIds: ['c'], query: 'test', mode: 'hybrid' });
    expect(requests.at(-1)?.model).toBe('embed:two');
    await stopService(service.processHandle);
    service = await launchService({ env });
    expect(await (await call('/api/v1/knowledge/embedding-model')).json()).toMatchObject(next);
    expect((await call('/api/v1/local-ai/power', 'PUT', { enabled: true })).status).toBe(200);
    await call('/api/v1/search', 'POST', { collectionIds: ['c'], query: 'again', mode: 'vector' });
    expect(requests.at(-1)).toEqual({ model: 'embed:two', input: ['again'] });
    for (const id of ['first', 'second']) {
      const response = await call('/api/v1/index', 'POST', { collectionId: 'c', versionId: id, content: `research evidence ${id}` });
      expect(response.status).toBe(202);
      const { job } = await response.json() as { job: { id: string } };
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await (await call(`/api/v1/jobs/${encodeURIComponent(job.id)}`)).json() as { job: { state: string } };
        if (value.job.state === 'succeeded') break;
        if (value.job.state === 'failed') throw new Error('Fixture indexing failed.');
        await Bun.sleep(20);
      }
    }
    const query = { collectionIds: ['c'], query: 'research', mode: 'full-text' };
    const unranked = await (await call('/api/v1/search', 'POST', query)).json() as { results: import('@office/contracts/knowledge').RetrievalResult[] };
    expect(unranked.results).toHaveLength(2);
    expect((await call('/api/v1/knowledge/embedding-model', 'PUT', { ...next, rerankModel: 'rank:one' })).status).toBe(200);
    const ranked = await (await call('/api/v1/search', 'POST', query)).json() as typeof unranked;
    expect(ranked.results).toEqual([...unranked.results].reverse());
    expect(rerankCalls).toBe(1);
    failRerank = true;
    const failed = await call('/api/v1/search', 'POST', query);
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain('private-upstream');
    expect((await call('/api/v1/knowledge/embedding-model', 'PUT', next)).status).toBe(200);
    expect((await call('/api/v1/search', 'POST', query)).status).toBe(200);
  } finally {
    await stopService(service?.processHandle);
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
