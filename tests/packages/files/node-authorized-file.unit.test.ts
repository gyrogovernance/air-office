import { expect, test } from 'bun:test';
import { FileOperationError, type FileErrorCode } from '@office/contracts/file';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeAuthorizedFileAdapter } from '../../../packages/files/src/node-authorized-file.adapter';

const adapterFor = (root: string, maxBytes?: number) => new NodeAuthorizedFileAdapter({ root, ...(maxBytes === undefined ? {} : { maxBytes }) });

async function expectCode(run: () => Promise<unknown>, code: FileErrorCode) {
  try {
    await run();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(FileOperationError);
    expect((error as FileOperationError).code).toBe(code);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'air-files-adapter-'));
const root = join(scratch, 'root');
mkdirSync(root, { recursive: true });
mkdirSync(join(scratch, 'outside'), { recursive: true });
writeFileSync(join(root, 'note.md'), 'initial content', 'utf8');
writeFileSync(join(scratch, 'outside', 'secret.md'), 'external secret', 'utf8');

test('read returns content and a stable content hash version', async () => {
  const adapter = adapterFor(root);
  const file = await adapter.read('note.md');
  expect(file.name).toBe('note.md');
  expect(file.content).toBe('initial content');
  const again = await adapter.read('note.md');
  expect(again.version).toBe(file.version);
  expect(file.version).toMatch(/^[0-9a-f]{64}$/);
});

test('path traversal identifiers are rejected before touching the filesystem', async () => {
  const adapter = adapterFor(root);
  for (const id of ['../outside/secret.md', '..\\outside\\secret.md', '/etc/passwd', 'C:/Windows/system.ini', 'a/../../secret.md', '....//secret.md']) {
    await expectCode(() => adapter.read(id), 'file-unauthorized');
  }
});

test('absolute and traversal paths cannot be saved', async () => {
  const adapter = adapterFor(root);
  await expectCode(() => adapter.save('../outside/secret.md', 'owned', 'deadbeef'), 'file-unauthorized');
});

test('a symlink pointing outside the root is rejected for read and save', async () => {
  const adapter = adapterFor(root);
  const link = join(root, 'escape.md');
  try {
    symlinkSync(join(scratch, 'outside', 'secret.md'), link, 'file');
  } catch {
    return; // Symlink creation may require privileges on some Windows setups; skip honestly.
  }
  await expectCode(() => adapter.read('escape.md'), 'file-unauthorized');
  await expectCode(() => adapter.save('escape.md', 'owned', 'deadbeef'), 'file-unauthorized');
});

test('a stale expectedVersion is rejected as a distinct error and does not write', async () => {
  const adapter = adapterFor(root);
  const file = await adapter.read('note.md');
  await adapter.save('note.md', 'updated once', file.version);
  await expectCode(() => adapter.save('note.md', 'clobber', file.version), 'file-stale-version');
  expect((await adapter.read('note.md')).content).toBe('updated once');
});

test('files above the size limit are rejected on read and save', async () => {
  const adapter = adapterFor(root, 16);
  writeFileSync(join(root, 'big.md'), 'x'.repeat(64), 'utf8');
  await expectCode(() => adapter.read('big.md'), 'file-too-large');
  const small = await adapter.read('note.md');
  await expectCode(() => adapter.save('note.md', 'y'.repeat(64), small.version), 'file-too-large');
});

test('non-allowlisted extensions are rejected and unknown files are not found', async () => {
  const adapter = adapterFor(root);
  writeFileSync(join(root, 'binary.bin'), 'data', 'utf8');
  await expectCode(() => adapter.read('binary.bin'), 'file-unsupported-type');
  await expectCode(() => adapter.read('missing.md'), 'file-not-found');
});

test('list returns only allowlisted files with versions and never escapes the root', async () => {
  const adapter = adapterFor(root);
  const names = (await adapter.list()).map((file) => file.name);
  expect(names).toContain('note.md');
  expect(names).not.toContain('binary.bin');
  expect(names.every((name) => !name.includes('/') && !name.includes('\\'))).toBe(true);
});

test('a file inside the root created through the adapter is read back', async () => {
  const adapter = adapterFor(root);
  const created = await adapter.create('fresh.md');
  expect(created.content).toBe('');
  const saved = await adapter.save('fresh.md', 'hello', created.version);
  expect((await adapter.read('fresh.md')).content).toBe('hello');
  expect(saved.version).toBe((await adapter.read('fresh.md')).version);
  rmSync(join(root, 'fresh.md'), { force: true });
});
