import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { createRichDocument, markdownToNativeBody } from '@office/editor/rich-document-domain';
import { MAX_BUNDLE_BYTES } from '@office/contracts/export';
import { launchService, stopService } from '../../support/service-launch.adapter';

let processHandle: Subprocess;
let port: number;
let token: string;
let base: string;
const scratch = mkdtempSync(join(tmpdir(), 'air-export-service-'));
const scratchRestore = join(scratch, 'restore-workspace');
const filesRoot = join(scratch, 'authorized-root');
mkdirSync(filesRoot, { recursive: true });

const dbEnv = (root: string) => ({
  OFFICE_DATA_ROOT: root,
  AIR_VAULT_ROOT: join(root, 'vault'),
  OFFICE_STORAGE_CONFIG: join(root, 'private', 'storage-location.json'),
  OFFICE_RUNTIME_DIR: join(root, 'private', 'workspace'),
  OFFICE_FILES_ROOT: join(root, 'private', 'files'),
  OFFICE_DEFAULT_LOCAL_AI_DIR: join(root, 'models'),
  OFFICE_CHAT_DATABASE_PATH: join(root, 'private', 'chat.sqlite'),
  OFFICE_DOCUMENTS_DATABASE_PATH: join(root, 'private', 'documents.sqlite'),
  OFFICE_KNOWLEDGE_DATABASE_PATH: join(root, 'private', 'knowledge.sqlite'),
  OFFICE_JOBS_DATABASE_PATH: join(root, 'private', 'jobs.sqlite'),
});
const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const launch = async (extraEnv: Record<string, string> = {}) => {
  const launched = await launchService({
    env: {
      ...dbEnv(scratch),
      OFFICE_LAB_PACK: 'false',
      OPENAI_API_KEY: 'sk-should-never-leave-service',
      OFFICE_CREDENTIALS: 'environment',
      ...extraEnv
    }
  });
  processHandle = launched.processHandle;
  port = launched.port;
  base = launched.base;
  token = launched.token;
};
const stop = async () => { await stopService(processHandle); };
beforeAll(launch, 30_000);
afterAll(async () => { await stop(); rmSync(scratch, { recursive: true, force: true }); }, 30_000);

async function seedWorkspace() {
  const collection = await (await fetch(`${base}/api/v1/collections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'col-export', name: 'Export reference' }) })).json() as { collection: { id: string } };
  expect(collection.collection.id).toBe('col-export');
  const ingest = await (await fetch(`${base}/api/v1/documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ documentId: 'doc-export', name: 'notes.txt', collectionId: 'col-export', content: 'Portable retrieval text with an anchor target.' }) })).json() as { version: { id: string } };
  await fetch(`${base}/api/v1/index`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionId: 'col-export', versionId: ingest.version.id, content: 'Portable retrieval text with an anchor target.' }) });
  await fetch(`${base}/api/v1/conversations`, { method: 'POST', headers: headers(), body: JSON.stringify({ conversationId: 'conv-export' }) });
  await fetch(`${base}/api/v1/conversations/conv-export/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'm1', parentId: null, role: 'user', content: 'Export question', complete: true }) });
  await fetch(`${base}/api/v1/conversations/conv-export/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'm2', parentId: 'm1', role: 'assistant', content: 'Export answer', complete: true, runId: 'run-1' }) });
}

test('T-023: export bundles a workspace without provider material and roundtrips through import', async () => {
  await seedWorkspace();
  const exportResponse = await fetch(`${base}/api/v1/export`, { headers: headers() });
  expect(exportResponse.status).toBe(200);
  const bundle = await exportResponse.json() as { manifest: { counts: Record<string, number>; payloadSha256: string }; payload: { conversations: unknown[]; collections: unknown[]; documents: { versions: { sourceBase64: string | null }[] }[] } };
  expect(bundle.manifest.counts).toEqual({ conversations: 1, collections: 1, documents: 1, versions: 1 });
  expect(bundle.payload.documents[0]?.versions[0]?.sourceBase64).toBe(Buffer.from('Portable retrieval text with an anchor target.').toString('base64'));
  expect(JSON.stringify(bundle)).not.toContain('sk-should-never-leave-service');

  const importResponse = await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(bundle) });
  expect(importResponse.status).toBe(200);
  const report = await importResponse.json() as { accepted: boolean; restored: { conversations: number; collections: number; documents: number; versions: number } };
  expect(report.accepted).toBe(true);
  expect(report.restored).toEqual({ conversations: 0, collections: 0, documents: 0, versions: 0 });

  const again = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as typeof bundle;
  expect(again.payload).toEqual(bundle.payload);
});

test('T-023: restore reaches a second workspace with identical payload', async () => {
  const source = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as { payload: unknown };
  await stop();
  mkdirSync(scratchRestore, { recursive: true });
  await launch({ ...dbEnv(scratchRestore), OFFICE_FILES_ROOT: scratchRestore });
  const importResponse = await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(source) });
  expect(importResponse.status).toBe(200);
  const restored = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as { payload: unknown };
  expect(restored.payload).toEqual(source.payload);
}, 30_000);

test('T-023: traversal, tamper, and oversized bundles are rejected with explicit codes', async () => {
  const good = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as { manifest: Record<string, unknown>; payload: { documents: { path: string }[] } };

  const traversal = structuredClone(good);
  traversal.payload.documents[0].path = '../../outside/keys';
  const traversalResponse = await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(traversal) });
  expect(traversalResponse.status).toBe(400);
  expect(((await traversalResponse.json()) as { rejections: { code: string }[] }).rejections[0].code).toBe('path-traversal');

  const tampered = structuredClone(good);
  (tampered.payload as unknown as { conversations: { title: string }[] }).conversations[0].title = 'Edited after export';
  const tamperedResponse = await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(tampered) });
  expect(tamperedResponse.status).toBe(400);
  expect(((await tamperedResponse.json()) as { rejections: { code: string }[] }).rejections[0].code).toBe('fingerprint-mismatch');

  const oversizedResponse = await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: 'x'.repeat(MAX_BUNDLE_BYTES + 1) });
  expect(oversizedResponse.status).toBe(413);
  expect(((await oversizedResponse.json()) as { rejections: { code: string }[] }).rejections[0].code).toBe('oversized');
});

test('workspace export restores notes, definitions, organization and paused schedules into a fresh workspace', async () => {
  const note = { ...createRichDocument('Portable note', 'portable-note'), body: markdownToNativeBody('# Portable note\n\nPreserved content.') };
  const prompt = { kind: 'prompt', value: { id: 'portable-prompt', name: 'Portable prompt', instructions: 'Summarize {{subject}}.', variables: ['subject'], updatedAt: new Date().toISOString() } };
  expect((await fetch(`${base}/api/v1/rich-documents`, { method: 'POST', headers: headers(), body: JSON.stringify(note) })).status).toBe(201);
  expect((await fetch(`${base}/api/v1/methods`, { method: 'POST', headers: headers(), body: JSON.stringify(prompt) })).status).toBe(201);
  const savedNote = await (await fetch(`${base}/api/v1/rich-documents/${encodeURIComponent(note.id)}`, { headers: headers() })).json() as { document: { id: string; path?: string; title: string } };
  const noteTarget = savedNote.document.path ?? savedNote.document.id;
  const programResponse = await fetch(`${base}/api/v1/workspace/nodes`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'portable-program', kind: 'program', name: 'Portable program', instruction: 'Use the program context.' }) });
  expect(programResponse.status).toBe(201);
  const program = (await programResponse.json() as { node: { id: string } }).node;
  const projectResponse = await fetch(`${base}/api/v1/workspace/nodes`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'portable-project', kind: 'project', parentId: program.id, name: 'Portable project' }) });
  expect(projectResponse.status).toBe(201);
  const project = (await projectResponse.json() as { node: { id: string } }).node;
  const noteNodeResponse = await fetch(`${base}/api/v1/workspace/nodes`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'portable-note-node', kind: 'note', parentId: project.id, name: note.title, targetId: noteTarget }) });
  expect(noteNodeResponse.status).toBe(201);
  expect((await fetch(`${base}/api/v1/conversations`, { method: 'POST', headers: headers(), body: JSON.stringify({ conversationId: 'portable-chat' }) })).status).toBe(201);
  expect((await fetch(`${base}/api/v1/conversations/portable-chat`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ folderId: project.id }) })).status).toBe(200);
  const now = new Date().toISOString();
  const schedule = { id: 'portable-schedule', path: 'automations/portable-schedule.automation.yaml', name: 'Portable schedule', enabled: true, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: '2030-01-01' }, missedRunPolicy: 'skip', steps: [{ kind: 'action', actionPath: 'actions/portable-action.md', source: 'Source to preserve', instructions: 'Keep it short', providerId: 'local-replay', modelId: 'local-replay', definition: { name: 'Portable action', system: 'Use the source', runPrompts: ['Summarize'] } }], createdAt: now, updatedAt: now };
  expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: schedule }) })).status).toBe(201);
  const sensitive = { ...schedule, id: 'credential-schedule', path: 'automations/credential-schedule.automation.yaml', enabled: false, steps: [{ kind: 'tool', toolId: 'external-tool', input: { apiKey: 'synthetic-private-value' } }] };
  expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: sensitive }) })).status).toBe(201);
  const bundle = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as { payload: { omittedSchedules: number } };
  expect(bundle.payload.omittedSchedules).toBe(1);
  expect(JSON.stringify(bundle)).not.toContain('synthetic-private-value');
  await stop();
  const destination = join(scratch, 'portable-destination');
  await launch({ ...dbEnv(destination), OFFICE_FILES_ROOT: destination });
  expect((await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(bundle) })).status).toBe(200);
  const restoredNote = await fetch(`${base}/api/v1/rich-documents/${note.id}`, { headers: headers() });
  expect(restoredNote.status).toBe(200);
  const restored = await restoredNote.json() as { document: typeof note & { path?: string } };
  expect(restored).toMatchObject({ document: { id: note.id, title: note.title, body: note.body } });
  expect(restored.document.path ?? '').toMatch(/\.note\.json$/);
  const restoredMethods = await (await fetch(`${base}/api/v1/methods`, { headers: headers() })).json() as { definitions: unknown[] };
  expect(restoredMethods.definitions).toContainEqual(expect.objectContaining({ kind: 'prompt', value: expect.objectContaining({ id: 'portable-prompt', instructions: expect.stringContaining('Summarize {{subject}}.') }) }));
  const restoredNodes = await (await fetch(`${base}/api/v1/workspace/nodes`, { headers: headers() })).json() as { nodes: unknown[] };
  expect(restoredNodes.nodes).toContainEqual(expect.objectContaining({
    id: 'program:portable-program',
    kind: 'program',
    name: 'Portable program',
    instruction: 'Use the program context.',
  }));
  expect(restoredNodes.nodes).toContainEqual(expect.objectContaining({
    id: 'project:portable-program/portable-project',
    kind: 'project',
    parentId: 'program:portable-program',
    name: 'Portable project',
  }));
  expect(restoredNodes.nodes).toContainEqual(expect.objectContaining({
    kind: 'note',
    parentId: 'project:portable-program/portable-project',
    targetId: expect.stringMatching(/programs\/portable-program\/projects\/portable-project\/notes\/.+\.note\.json$/),
    name: note.title,
  }));
  const restoredChat = await (await fetch(`${base}/api/v1/conversations/portable-chat`, { headers: headers() })).json() as { conversation: { conversation: { folderId: string | null } } };
  expect(restoredChat.conversation.conversation.folderId).toBe(project.id);
  const importedSchedules = await (await fetch(`${base}/api/v1/automations`, { headers: headers() })).json() as { automations: { id: string; enabled: boolean }[] };
  expect(importedSchedules.automations).toContainEqual(expect.objectContaining({ id: schedule.id, enabled: false }));
  expect(importedSchedules.automations.some((item) => item.id === 'credential-schedule')).toBe(false);
  expect((await fetch(`${base}/api/v1/rich-documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ ...restored.document, title: 'Local edit' }) })).status).toBe(201);
  const repeated = await (await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(bundle) })).json() as { portableWork: { conflicts: { kind: string; id: string }[] } };
  expect(repeated.portableWork.conflicts).toEqual(expect.arrayContaining([{ kind: 'rich-document', id: note.id }, { kind: 'method', id: 'portable-prompt' }]));
  expect(await (await fetch(`${base}/api/v1/rich-documents/${note.id}`, { headers: headers() })).json()).toMatchObject({ document: { title: 'Local edit' } });
}, 30_000);

test('invalid workspace organization is rejected before importing notes', async () => {
  const bundle = await (await fetch(`${base}/api/v1/export`, { headers: headers() })).json() as { manifest: { payloadSha256: string }; payload: { richDocuments: unknown[]; workspaceNodes: unknown[] } };
  bundle.payload.richDocuments.push(createRichDocument('Do not import', 'invalid-graph-note'));
  bundle.payload.workspaceNodes = [
    { id: 'cycle-a', kind: 'folder', parentId: 'cycle-b', name: 'A', instruction: '' },
    { id: 'cycle-b', kind: 'folder', parentId: 'cycle-a', name: 'B', instruction: '' }
  ];
  bundle.manifest.payloadSha256 = new Bun.CryptoHasher('sha256').update(JSON.stringify(bundle.payload)).digest('hex');
  expect((await fetch(`${base}/api/v1/import`, { method: 'POST', headers: headers(), body: JSON.stringify(bundle) })).status).toBe(400);
  expect((await fetch(`${base}/api/v1/rich-documents/invalid-graph-note`, { headers: headers() })).status).toBe(404);
});
