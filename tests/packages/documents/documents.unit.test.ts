import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractionArtifact } from '@office/contracts/document';
import { createSqliteDocumentStore } from '../../../packages/documents/src/document-store.adapter';
import { createDocumentsService, hashBytes } from '../../../packages/documents/src/documents.service.public';
import { pageAnchorsForArtifact, resolveAnchor, sourceKindForName, hasBlockingWarning } from '../../../packages/documents/src/documents.domain.public';
import type { ExtractionWorker } from '../../../packages/documents/src/extraction-worker.port';

const artifact = (text: string, overrides: Partial<ExtractionArtifact> = {}): ExtractionArtifact => ({
  extractor: 'fixture', extractorVersion: '1', extractionVersion: 'anchor-v1', text, pageCount: null, warnings: [], contentHash: hashBytes(new TextEncoder().encode(text)), createdAt: new Date(0).toISOString(), ...overrides
});

test('an unknown extension is an explicit unsupported kind, not a guess', () => {
  expect(sourceKindForName('report.pdf')).toBe('pdf');
  expect(sourceKindForName('notes.MD')).toBe('markdown');
  expect(sourceKindForName('scan.TIFF')).toBe('image');
  expect(sourceKindForName('archive.zip')).toBe('unsupported');
});

test('recording the same bytes twice is idempotent and keeps one version', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const store = createSqliteDocumentStore(join(scratch, 'docs.sqlite'));
  try {
    const service = createDocumentsService(store);
    const bytes = new TextEncoder().encode('hello world');
    const first = service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes });
    const second = service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(service.versions('d1')).toHaveLength(1);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('vault originals are source-byte authority and win over store bytes', () => {
  const previousVault = process.env.AIR_VAULT_ROOT;
  const vault = mkdtempSync(join(tmpdir(), 'air-documents-vault-'));
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const dbPath = join(scratch, 'docs.sqlite');
  process.env.AIR_VAULT_ROOT = vault;
  const store = createSqliteDocumentStore(dbPath);
  try {
    const service = createDocumentsService(store);
    const bytes = new TextEncoder().encode('vault authority payload');
    const contentHash = hashBytes(bytes);
    const { version } = service.ingest({ documentId: 'd-vault', name: 'notes.txt', collectionId: 'team-a', bytes });
    const originalPath = join(vault, 'sources', 'team-a', 'originals', `${contentHash}.txt`);
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(join(vault, 'sources', 'team-a', 'meta', `${contentHash}.yaml`))).toBe(true);
    expect(existsSync(join(vault, 'sources', 'team-a', 'collection.yaml'))).toBe(true);
    expect(Array.from(service.sourceBytes(version.id) ?? [])).toEqual(Array.from(bytes));

    service.retainSourceBytes(version.id, bytes);
    const poison = new Database(dbPath);
    poison.query('UPDATE document_bytes SET content = ? WHERE version_id = ?').run(new TextEncoder().encode('stale sqlite payload'), version.id);
    poison.close();
    expect(Array.from(service.sourceBytes(version.id) ?? [])).toEqual(Array.from(bytes));

    service.ingest({ documentId: 'd-vault', name: 'notes.txt', collectionId: 'team-a', bytes });
    expect(existsSync(originalPath)).toBe(true);
    service.clearPersonalData();
    expect(existsSync(originalPath)).toBe(true);
    expect(service.sourceBytes(version.id)).toBeNull();
  } finally {
    store.close();
    rmSync(scratch, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    if (previousVault === undefined) delete process.env.AIR_VAULT_ROOT;
    else process.env.AIR_VAULT_ROOT = previousVault;
  }
});

test('sourceBytes fails loud when the vault is configured but the original is missing', () => {
  const previousVault = process.env.AIR_VAULT_ROOT;
  const vault = mkdtempSync(join(tmpdir(), 'air-documents-vault-miss-'));
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  process.env.AIR_VAULT_ROOT = vault;
  const store = createSqliteDocumentStore(join(scratch, 'docs.sqlite'));
  try {
    const service = createDocumentsService(store);
    const bytes = new Uint8Array([9, 8, 7]);
    const { version } = service.ingest({ documentId: 'd-miss', name: 'image.png', collectionId: null, bytes });
    service.retainSourceBytes(version.id, bytes);
    const originalPath = join(vault, 'sources', 'inbox', 'originals', `${hashBytes(bytes)}.png`);
    expect(existsSync(originalPath)).toBe(true);
    rmSync(originalPath, { force: true });
    expect(() => service.sourceBytes(version.id)).toThrow(/Vault original missing/);
  } finally {
    store.close();
    rmSync(scratch, { recursive: true, force: true });
    rmSync(vault, { recursive: true, force: true });
    if (previousVault === undefined) delete process.env.AIR_VAULT_ROOT;
    else process.env.AIR_VAULT_ROOT = previousVault;
  }
});

test('retained source bytes survive a store restart and reject a different payload', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const path = join(scratch, 'docs.sqlite');
  let store = createSqliteDocumentStore(path);
  try {
    const bytes = new Uint8Array([0, 3, 255, 12]);
    const service = createDocumentsService(store);
    const { version } = service.ingest({ documentId: 'attachment', name: 'image.png', collectionId: null, bytes });
    expect(() => service.retainSourceBytes(version.id, new Uint8Array([1]))).toThrow();
    service.retainSourceBytes(version.id, bytes);
    store.close();
    store = createSqliteDocumentStore(path);
    expect(Array.from(createDocumentsService(store).sourceBytes(version.id) ?? [])).toEqual([0, 3, 255, 12]);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a revised source creates a distinct immutable version', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const store = createSqliteDocumentStore(join(scratch, 'docs.sqlite'));
  try {
    const service = createDocumentsService(store);
    service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes: new TextEncoder().encode('v1') });
    service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes: new TextEncoder().encode('v2') });
    expect(service.versions('d1')).toHaveLength(2);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a text-range anchor resolves to the exact byte slice and an out-of-range anchor does not', () => {
  const bytes = new TextEncoder().encode('abcdef');
  const resolved = resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 2, endByte: 5 }, artifact('abcdef'));
  expect(resolved).toEqual({ resolved: true, text: 'cde' });
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 1, endByte: 99 }, artifact('abcdef')).resolved).toBe(false);
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'other', kind: 'text-range', startByte: 0, endByte: 2 }, artifact('abcdef')).resolved).toBe(false);
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 1, endByte: 2 }, artifact('aé')).resolved).toBe(false);
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 1, endByte: 3 }, artifact('aé'))).toEqual({ resolved: true, text: 'é' });
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 0.5, endByte: 2 }, artifact('abc')).resolved).toBe(false);
});

test('a page anchor is unresolved when the artifact has no pages', () => {
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'page', page: 1 }, artifact('text')).resolved).toBe(false);
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'page', page: 2 }, artifact('text', { pageCount: 3 })).resolved).toBe(true);
});

test('a page anchor returns stored page text and pageAnchorsForArtifact covers every page', () => {
  const withPages = artifact('page one\n\npage two', {
    pageCount: 2,
    pages: [{ page: 1, text: 'page one' }, { page: 2, text: 'page two' }]
  });
  expect(resolveAnchor({ sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'page', page: 1 }, withPages)).toEqual({ resolved: true, text: 'page one' });
  expect(pageAnchorsForArtifact('v1', withPages)).toEqual([
    { sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'page', page: 1 },
    { sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'page', page: 2 }
  ]);
});

test('a corrupt or encrypted warning is blocking', () => {
  expect(hasBlockingWarning(artifact('text', { warnings: [{ code: 'corrupt', message: 'bad' }] }))).toBe(true);
  expect(hasBlockingWarning(artifact('text', { warnings: [{ code: 'ocr-low-confidence', message: 'low', page: 1 }] }))).toBe(false);
});

test('extraction caches by extractor identity and surfaces worker output', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const store = createSqliteDocumentStore(join(scratch, 'docs.sqlite'));
  try {
    let calls = 0;
    const worker: ExtractionWorker = { protocolVersion: 1, extractor: 'fixture', extractorVersion: '1', extract: async () => { calls += 1; return { artifact: artifact('extracted text') }; } };
    const service = createDocumentsService(store, worker);
    const { version } = service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes: new TextEncoder().encode('raw') });
    const first = await service.extract(version.id, 'ignored');
    const second = await service.extract(version.id, 'ignored');
    expect(first.text).toBe('extracted text');
    expect(second.extractor).toBe('fixture');
    expect(calls).toBe(1);
    expect(service.artifact(version.id)?.extractionVersion).toBe('anchor-v1');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a worker abort propagates and leaves no artifact', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-documents-'));
  const store = createSqliteDocumentStore(join(scratch, 'docs.sqlite'));
  try {
    const worker: ExtractionWorker = { protocolVersion: 1, extractor: 'fixture', extractorVersion: '1', extract: async ({ signal }) => { if (signal?.aborted) throw new Error('cancelled'); return new Promise((_, reject) => { signal?.addEventListener('abort', () => reject(new Error('cancelled'))); }); } };
    const service = createDocumentsService(store, worker);
    const { version } = service.ingest({ documentId: 'd1', name: 'notes.txt', collectionId: null, bytes: new TextEncoder().encode('raw') });
    const controller = new AbortController();
    const pending = service.extract(version.id, 'ignored', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(service.artifact(version.id)).toBeNull();
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
