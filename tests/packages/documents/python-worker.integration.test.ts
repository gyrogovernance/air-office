import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PythonExtractionWorker } from '../../../packages/documents/src/python-worker.adapter';
import { ensureDocumentWorkerPython } from '../../../packages/documents/src/document-worker-python.adapter';
import type { ExtractionWorker } from '../../../packages/documents/src/extraction-worker.port';

const workerRoot = join(import.meta.dir, '..', '..', '..', 'workers', 'documents');
const fixtures = join(workerRoot, 'fixtures');
const python = ensureDocumentWorkerPython(workerRoot);
const available = Boolean(python) && existsSync(join(workerRoot, 'pyproject.toml'));
const options = { command: [python ?? 'python', '-m', 'office_documents.main'], cwd: workerRoot, env: { PYTHONPATH: join(workerRoot, 'src') } };

describe.if(available)('managed Python extraction worker', () => {
  test('advertises a protocol version before accepting work', async () => {
    const worker: ExtractionWorker = await PythonExtractionWorker.start(options);
    expect(worker.protocolVersion).toBe(1);
    expect(worker.extractor).toBe('office-documents');
  });

  test('extracts text through the real worker process', async () => {
    const worker = await PythonExtractionWorker.start(options);
    const { artifact } = await worker.extract({ sourceVersionId: 'v1', kind: 'text', inputPath: join(fixtures, 'plain-utf8.txt') });
    expect(artifact.text).toContain('quick brown fox');
    expect(artifact.extractionVersion).toBe('anchor-v1');
    expect(artifact.contentHash).toHaveLength(64);
    expect(artifact.warnings).toEqual([]);
  });

  test('a corrupt input returns a warning rather than a fabricated result', async () => {
    const worker = await PythonExtractionWorker.start(options);
    const { artifact } = await worker.extract({ sourceVersionId: 'v1', kind: 'text', inputPath: join(fixtures, 'invalid-encoding.txt') });
    expect(artifact.warnings.some((warning) => warning.code === 'corrupt')).toBe(true);
  });

  test('an aborted extraction rejects and does not resolve', async () => {
    const worker = await PythonExtractionWorker.start(options);
    const controller = new AbortController();
    const pending = worker.extract({ sourceVersionId: 'v1', kind: 'text', inputPath: join(fixtures, 'plain-utf8.txt'), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  test('a protocol mismatch is rejected at startup', async () => {
    await expect(PythonExtractionWorker.start({ ...options, expectedProtocolVersion: 99 })).rejects.toThrow('does not match');
  });

  test('a worker refusal rejects the request instead of waiting for a response that never comes', async () => {
    // The refusal line carries `ok: false` without a request id, arriving right
    // after the capability advertisement; dropping it left requests hanging.
    const worker = await PythonExtractionWorker.start(options);
    await expect(worker.extract({ sourceVersionId: 'v1', kind: 'unsupported', inputPath: join(fixtures, 'plain-utf8.txt') })).rejects.toThrow();
  });
});
