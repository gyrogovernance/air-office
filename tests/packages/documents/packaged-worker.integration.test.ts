import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PythonExtractionWorker } from '../../../packages/documents/src/python-worker.adapter';

const root = resolve(import.meta.dir, '../../..');
const executable = resolve(root, 'workers/documents/dist', `${process.platform}-${process.arch}`, 'air-office-documents', `air-office-documents${process.platform === 'win32' ? '.exe' : ''}`);

test('a worker that never advertises readiness cannot block service startup', async () => {
  await expect(PythonExtractionWorker.start({ command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], startupTimeoutMs: 100 })).rejects.toThrow('startup deadline');
});

describe.if(existsSync(executable))('packaged document reader', () => {
  test('reads text and PDF without a host Python installation on PATH', async () => {
    const worker = await PythonExtractionWorker.start({ command: [executable], env: { PATH: '', PYTHONPATH: '', PYTHONHOME: '' } });
    const text = await worker.extract({ sourceVersionId: 'text', kind: 'text', inputPath: resolve(root, 'workers/documents/fixtures/plain-utf8.txt') });
    expect(text.artifact.text).toContain('quick brown fox');
    const pdf = await worker.extract({ sourceVersionId: 'pdf', kind: 'pdf', inputPath: resolve(root, 'workers/documents/fixtures/clean.pdf') });
    expect(pdf.artifact.text.trim().length).toBeGreaterThan(0);
    expect(pdf.artifact.pageCount).toBeGreaterThan(0);
  });
});
