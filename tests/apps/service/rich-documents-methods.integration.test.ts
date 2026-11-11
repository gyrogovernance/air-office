import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import type { RichDocument } from '@office/editor/rich-document-domain';
import { createRichDocument, markdownToNativeBody } from '@office/editor/rich-document-domain';
import type { MethodDefinition, MethodsBundle, MethodVersion } from '@office/methods/domain';
import { launchService, stopService } from '../../support/service-launch.adapter';

const scratch = mkdtempSync(join(tmpdir(), 'air-rich-methods-service-'));
const filesRoot = join(scratch, 'authorized-root');
mkdirSync(filesRoot, { recursive: true });
let processHandle: Subprocess | undefined;
let base: string;
let token: string;

beforeAll(async () => {
  const launched = await launchService({
    env: {
      OFFICE_RUNTIME_DIR: scratch,
      OFFICE_CHAT_DATABASE_PATH: join(scratch, 'chat.sqlite'),
      OFFICE_DOCUMENTS_DATABASE_PATH: join(scratch, 'documents.sqlite'),
      OFFICE_KNOWLEDGE_DATABASE_PATH: join(scratch, 'knowledge.sqlite'),
      OFFICE_JOBS_DATABASE_PATH: join(scratch, 'jobs.sqlite'),
      OFFICE_FILES_ROOT: filesRoot,
      OFFICE_CREDENTIALS: 'environment'
    }
  });
  processHandle = launched.processHandle;
  base = launched.base;
  token = launched.token;
}, 30_000);

afterAll(async () => {
  try {
    await stopService(processHandle);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 30_000);

const request = (path: string, method = 'GET', body?: unknown) => fetch(`${base}/api/v1/${path}`, {
  method,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const timestamp = '2026-10-12T10:00:00.000Z';
const prompt = (id: string, instructions = 'Summarize {{topic}}.'): MethodDefinition => ({
  kind: 'prompt', value: { id, name: 'Summary prompt', instructions, variables: ['topic'], updatedAt: timestamp }
});
const skill = (id: string): MethodDefinition => ({
  kind: 'skill', value: { id, name: 'Plain language', description: 'Use clear language.', instructions: 'Explain unfamiliar terms.', updatedAt: timestamp }
});
const preset = (id: string): MethodDefinition => ({
  kind: 'preset', value: { id, name: 'Summary agent', model: 'local-replay', provider: 'local-replay', modelReference: { providerId: 'local-replay', modelId: 'local-replay', role: 'chat' }, instructions: 'Write a short summary.', settings: { temperature: 0.4, maxOutputTokens: 512 }, knowledgeCollectionIds: [], skillIds: [], toolIds: [], updatedAt: timestamp }
});
const save = async (definition: MethodDefinition) => {
  const response = await request('methods', 'POST', definition);
  expect(response.status).toBe(201);
  return (await response.json() as { definition: MethodDefinition }).definition;
};
const readMethod = async (id: string) => {
  const response = await request(`methods/${encodeURIComponent(id)}`);
  expect(response.status).toBe(200);
  return (await response.json() as { definition: MethodDefinition }).definition;
};
const history = async (id: string) => {
  const response = await request(`methods/${encodeURIComponent(id)}/history`);
  expect(response.status).toBe(200);
  return (await response.json() as { history: MethodVersion[] }).history;
};
const bundle = (definitions: MethodDefinition[]): MethodsBundle => ({ format: 'air-office.methods', version: 1, definitions });
const note = (id: string): RichDocument => ({
  ...createRichDocument('Research note', id),
  updatedAt: timestamp,
  body: markdownToNativeBody('## Findings\n\n**Keep the attachment.**'),
  attachments: [{ id: 'attachment-1', name: 'evidence.txt', mediaType: 'text/plain', size: 8, dataUrl: 'data:text/plain;base64,ZXZpZGVuY2U=' }]
});
const readNote = async (id: string) => {
  const response = await request(`rich-documents/${encodeURIComponent(id)}`);
  expect(response.status).toBe(200);
  return (await response.json() as { document: RichDocument }).document;
};

test('rich notes save, edit and reopen canonical content with attachment bytes intact', async () => {
  const original = note('rich-roundtrip');
  const created = await request('rich-documents', 'POST', original);
  expect(created.status).toBe(201);
  const saved = (await created.json() as { document: RichDocument }).document;
  expect(saved).toEqual({ ...original, updatedAt: saved.updatedAt });
  expect(await readNote(original.id)).toEqual(saved);
  const edited: RichDocument = { ...saved, title: 'Revised research note', body: markdownToNativeBody('Revised findings.') };
  const updated = await request('rich-documents', 'POST', edited);
  expect(updated.status).toBe(201);
  const final = (await updated.json() as { document: RichDocument }).document;
  expect(final).toEqual({ ...edited, updatedAt: final.updatedAt });
  expect(await readNote(original.id)).toEqual(final);
  expect(Buffer.from(final.attachments[0]!.dataUrl.split(',')[1]!, 'base64').toString()).toBe('evidence');
  const listed = await request('rich-documents');
  expect(listed.status).toBe(200);
  expect((await listed.json() as { documents: RichDocument[] }).documents.filter((document) => document.id === original.id)).toEqual([final]);
});

test('invalid rich content and attachments return 400 without changing the saved note', async () => {
  const original = note('rich-invalid');
  const response = await request('rich-documents', 'POST', original);
  expect(response.status).toBe(201);
  const saved = (await response.json() as { document: RichDocument }).document;
  const invalid: unknown[] = [
    { ...saved, body: null },
    { ...saved, body: { type: 'doc', content: [] } },
    { ...saved, attachments: [{ ...saved.attachments[0]!, size: 9 }] }
  ];
  for (const payload of invalid) {
    expect((await request('rich-documents', 'POST', payload)).status).toBe(400);
    expect(await readNote(saved.id)).toEqual(saved);
  }
});

test('each method kind saves, edits and restores an earlier revision through HTTP', async () => {
  for (const original of [preset('history-preset'), prompt('history-prompt'), skill('history-skill')]) {
    const saved = await save(original);
    expect(saved.kind).toBe(original.kind);
    expect(saved.value).toEqual({ ...original.value, updatedAt: saved.value.updatedAt });
    const initialHistory = await history(original.value.id);
    expect(initialHistory).toHaveLength(1);
    expect(initialHistory[0]).toMatchObject({ definitionId: original.value.id, kind: original.kind, revision: 1, value: saved.value });
    const edited = await save({ ...saved, value: { ...saved.value, instructions: 'Locally edited instructions.' } } as MethodDefinition);
    expect(await readMethod(original.value.id)).toEqual(edited);
    expect((await history(original.value.id)).map((version) => version.revision)).toEqual([2, 1]);
    const restored = await request(`methods/${original.value.id}`, 'PATCH', { versionId: initialHistory[0]!.id });
    expect(restored.status).toBe(200);
    const restoredDefinition = (await restored.json() as { definition: MethodDefinition }).definition;
    expect(restoredDefinition.kind).toBe(saved.kind);
    expect(restoredDefinition.value).toEqual({ ...saved.value, updatedAt: restoredDefinition.value.updatedAt });
    expect(await readMethod(original.value.id)).toEqual(restoredDefinition);
    const finalHistory = await history(original.value.id);
    expect(finalHistory.map((version) => version.revision)).toEqual([3, 2, 1]);
    expect(finalHistory[1]!.value).toEqual(edited.value);
    expect(finalHistory[2]!.value).toEqual(saved.value);
  }
});

test('restoring another identity or an unknown version returns 404 without modifying either method', async () => {
  const source = await save(prompt('restore-source'));
  const target = await save(skill('restore-target'));
  const sourceHistory = await history(source.value.id);
  const targetHistory = await history(target.value.id);
  for (const versionId of [sourceHistory[0]!.id, 'missing-version']) {
    expect((await request(`methods/${target.value.id}`, 'PATCH', { versionId })).status).toBe(404);
    expect(await readMethod(source.value.id)).toEqual(source);
    expect(await readMethod(target.value.id)).toEqual(target);
    expect(await history(source.value.id)).toEqual(sourceHistory);
    expect(await history(target.value.id)).toEqual(targetHistory);
  }
});

test('invalid method definitions return 400 and preserve the current definition and history', async () => {
  const saved = await save(prompt('invalid-method'));
  const before = await history(saved.value.id);
  const invalid = [
    { ...saved, value: { ...saved.value, variables: ['Topic'] } },
    { ...saved, value: { ...saved.value, updatedAt: '2026-02-30T10:00:00Z' } },
    { ...preset('invalid-preset'), value: { ...preset('invalid-preset').value, settings: { temperature: 3 } } },
    { ...skill('invalid-skill'), value: { ...skill('invalid-skill').value, description: 42 } },
    { kind: 'unknown', value: saved.value }
  ];
  for (const definition of invalid) {
    expect((await request('methods', 'POST', definition)).status).toBe(400);
    expect(await readMethod(saved.value.id)).toEqual(saved);
    expect(await history(saved.value.id)).toEqual(before);
  }
  expect((await request('methods/invalid-preset')).status).toBe(404);
  expect((await request('methods/invalid-skill')).status).toBe(404);
});

test('bundle import reports conflicts, preserves local edits and saves only new identities', async () => {
  const source = prompt('import-local');
  await save(source);
  const local = await save({ ...source, value: { ...source.value, instructions: 'Preserve this local edit.' } } as MethodDefinition);
  const before = await history(local.value.id);
  const newDefinitions = [preset('import-new-preset'), skill('import-new-skill')];
  const response = await request('methods/import', 'POST', bundle([source, ...newDefinitions]));
  expect(response.status).toBe(201);
  const report = await response.json() as { imported: number; conflicts: { id: string; existingKind: string; incomingKind: string }[]; definitions: MethodDefinition[] };
  expect(report.imported).toBe(2);
  expect(report.conflicts).toEqual([{ id: local.value.id, existingKind: 'prompt', incomingKind: 'prompt' }]);
  expect(await readMethod(local.value.id)).toEqual(local);
  expect(await history(local.value.id)).toEqual(before);
  for (const definition of newDefinitions) {
    const saved = await readMethod(definition.value.id);
    expect(saved.kind).toBe(definition.kind);
    expect(saved.value).toEqual({ ...definition.value, updatedAt: saved.value.updatedAt });
    expect(report.definitions).toContainEqual(saved);
    expect(await history(definition.value.id)).toHaveLength(1);
  }
  const crossKind = await request('methods/import', 'POST', bundle([skill(local.value.id)]));
  expect(crossKind.status).toBe(201);
  expect(await crossKind.json()).toMatchObject({ imported: 0, conflicts: [{ id: local.value.id, existingKind: 'prompt', incomingKind: 'skill' }], definitions: [] });
  expect(await readMethod(local.value.id)).toEqual(local);
  expect(await history(local.value.id)).toEqual(before);
  const exported = await request('methods/export');
  expect(exported.status).toBe(200);
  const exportedBundle = (await exported.json() as { bundle: MethodsBundle }).bundle;
  expect(exportedBundle).toMatchObject({ format: 'air-office.methods', version: 1 });
  expect(exportedBundle.definitions).toContainEqual(local);
  for (const definition of report.definitions) expect(exportedBundle.definitions).toContainEqual(definition);
});

test('unsupported bundle versions return 400 before saving new identities or changing local methods', async () => {
  const local = await save(prompt('unsupported-local', 'Retain local instructions.'));
  const before = await history(local.value.id);
  for (const version of [0, 2, '1']) {
    const incoming = skill(`unsupported-new-${version}`);
    expect((await request('methods/import', 'POST', { ...bundle([prompt(local.value.id), incoming]), version })).status).toBe(400);
    expect((await request(`methods/${incoming.value.id}`)).status).toBe(404);
    expect(await readMethod(local.value.id)).toEqual(local);
    expect(await history(local.value.id)).toEqual(before);
  }
});
