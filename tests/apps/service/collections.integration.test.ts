import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { launchService, stopService } from '../../support/service-launch.adapter';

let processHandle: Subprocess;
let base: string;
let token = '';
const scratch = mkdtempSync(join(tmpdir(), 'air-collection-service-'));
mkdirSync(join(scratch, 'private'), { recursive: true });

const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const launch = async () => {
  const launched = await launchService({
    env: {
      OFFICE_DATA_ROOT: scratch,
      OFFICE_STORAGE_CONFIG: join(scratch, 'private', 'storage-location.json'),
      OFFICE_RUNTIME_DIR: join(scratch, 'private', 'workspace'),
      OFFICE_FILES_ROOT: join(scratch, 'private', 'files'),
      OFFICE_DEFAULT_LOCAL_AI_DIR: join(scratch, 'models'),
      OFFICE_CHAT_DATABASE_PATH: join(scratch, 'private', 'chat.sqlite'),
      OFFICE_DOCUMENTS_DATABASE_PATH: join(scratch, 'private', 'documents.sqlite'),
      OFFICE_KNOWLEDGE_DATABASE_PATH: join(scratch, 'private', 'knowledge.sqlite'),
      OFFICE_JOBS_DATABASE_PATH: join(scratch, 'private', 'jobs.sqlite'),
      OFFICE_LAB_PACK: 'false'
    }
  });
  processHandle = launched.processHandle;
  base = launched.base;
  token = launched.token;
};
beforeAll(launch, 30_000);
afterAll(async () => { await stopService(processHandle); rmSync(scratch, { recursive: true, force: true }); }, 30_000);

const create = async (id: string, name: string, description?: string) => fetch(`${base}/api/v1/collections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id, name, ...(description === undefined ? {} : { description }) }) });

test('a collection keeps its description, can be renamed and reports its documents', async () => {
  const created = await create('col-lifecycle', 'Regulatory base', 'Frameworks and guidance');
  expect(created.status).toBe(201);
  const body = await created.json() as { collection: { id: string; name: string; description?: string } };
  expect(body.collection.description).toBe('Frameworks and guidance');

  const listed = await (await fetch(`${base}/api/v1/collections`, { headers: headers() })).json() as { collections: { id: string; description?: string }[] };
  expect(listed.collections.find((entry) => entry.id === 'col-lifecycle')?.description).toBe('Frameworks and guidance');

  const renamed = await fetch(`${base}/api/v1/collections/col-lifecycle`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ name: 'Compliance base', description: 'Updated scope' }) });
  expect(renamed.status).toBe(200);
  const renamedBody = await renamed.json() as { collection: { name: string; description?: string } };
  expect(renamedBody.collection.name).toBe('Compliance base');
  expect(renamedBody.collection.description).toBe('Updated scope');
});

test('deleting a collection removes its documents so no source survives it', async () => {
  await create('col-removal', 'Doomed base');
  const ingest = await fetch(`${base}/api/v1/documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ documentId: 'doc-doomed', name: 'note.txt', collectionId: 'col-removal', content: 'Text that belongs to the removed collection.' }) });
  expect(ingest.status).toBe(201);

  const deleted = await fetch(`${base}/api/v1/collections/col-removal`, { method: 'DELETE', headers: headers() });
  expect(deleted.status).toBe(200);

  const documents = await (await fetch(`${base}/api/v1/documents`, { headers: headers() })).json() as { documents: { id: string }[] };
  expect(documents.documents.some((entry) => entry.id === 'doc-doomed')).toBe(false);
  const collections = await (await fetch(`${base}/api/v1/collections`, { headers: headers() })).json() as { collections: { id: string }[] };
  expect(collections.collections.some((entry) => entry.id === 'col-removal')).toBe(false);
});

test('an unknown collection is reported as unknown rather than created', async () => {
  const patched = await fetch(`${base}/api/v1/collections/col-absent`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ name: 'Ghost' }) });
  expect(patched.status).toBe(404);
  const deleted = await fetch(`${base}/api/v1/collections/col-absent`, { method: 'DELETE', headers: headers() });
  expect(deleted.status).toBe(404);
});

test('a collection without a name is refused', async () => {
  const refused = await create('col-empty', '   ');
  expect(refused.status).toBe(400);
});
