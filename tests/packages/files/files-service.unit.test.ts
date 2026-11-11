import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeAuthorizedFileAdapter } from '../../../packages/files/src/node-authorized-file.adapter';
import { createFilesService } from '../../../packages/files/src/files.entry';
import { createFilesystemExplorer } from '../../../packages/files/src/filesystem-explorer.service.public';
import { externalFileId, externalFileTarget } from '../../../packages/files/src/filesystem-explorer.domain.public';

const scratch = mkdtempSync(join(tmpdir(), 'air-files-service-'));
const root = join(scratch, 'root');
mkdirSync(root, { recursive: true });
writeFileSync(join(root, 'doc.md'), 'alpha beta gamma', 'utf8');
const service = createFilesService(new NodeAuthorizedFileAdapter({ root }));

test('read returns the authorized snapshot', async () => {
  const file = await service.read('doc.md');
  expect(file.content).toBe('alpha beta gamma');
});

test('save is version guarded and does not clobber on stale writes', async () => {
  const current = await service.read('doc.md');
  const saved = await service.save('doc.md', 'refined text', current.version);
  expect(saved.content).toBe('refined text');
  await expect(service.save('doc.md', 'stale', current.version)).rejects.toMatchObject({ code: 'file-stale-version' });
  expect((await service.read('doc.md')).content).toBe('refined text');
  rmSync(scratch, { recursive: true, force: true });
});

test('connected file reads and saves share stable identity and version guarded real filesystem access', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-connected-tools-'));
  const localRoot = join(directory, 'local'); const connectedRoot = join(directory, 'connected');
  mkdirSync(localRoot); mkdirSync(connectedRoot); mkdirSync(join(connectedRoot, 'nested'));
  writeFileSync(join(localRoot, 'default.md'), 'Default root');
  writeFileSync(join(connectedRoot, 'nested', 'π.md'), 'Connected original');
  const explorer = createFilesystemExplorer({ databasePath: join(directory, 'registry.sqlite') });
  try {
    const root = await explorer.connect({ path: connectedRoot });
    const files = createFilesService(new NodeAuthorizedFileAdapter({ root: localRoot }), explorer);
    const id = externalFileId({ rootId: root.id, path: 'nested/π.md' });
    expect(externalFileTarget(id)).toEqual({ rootId: root.id, path: 'nested/π.md' });
    const current = await files.read(id);
    expect(current).toMatchObject({ id, name: 'π.md', content: 'Connected original' });
    const saved = await files.save(id, 'Accepted edit', current.version);
    expect(saved).toMatchObject({ id, content: 'Accepted edit' });
    expect(readFileSync(join(connectedRoot, 'nested', 'π.md'), 'utf8')).toBe('Accepted edit');
    await expect(files.save(id, 'Stale overwrite', current.version)).rejects.toMatchObject({ code: 'file-stale-version' });
    expect((await files.read(id)).content).toBe('Accepted edit');
    expect((await files.read('default.md')).content).toBe('Default root');
    expect((await files.list()).map((file) => file.id)).toEqual(['default.md']);
  } finally { explorer.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('connected file access rejects invalid identifiers, escaped paths, unknown roots and disconnected folders', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-connected-boundary-'));
  const localRoot = join(directory, 'local'); const connectedRoot = join(directory, 'connected');
  mkdirSync(localRoot); mkdirSync(connectedRoot);
  writeFileSync(join(directory, 'outside.md'), 'Outside authorization');
  writeFileSync(join(connectedRoot, 'note.md'), 'Safe');
  const explorer = createFilesystemExplorer({ databasePath: join(directory, 'registry.sqlite') });
  try {
    const root = await explorer.connect({ path: connectedRoot });
    const files = createFilesService(new NodeAuthorizedFileAdapter({ root: localRoot }), explorer);
    const id = externalFileId({ rootId: root.id, path: 'note.md' });
    expect((await files.read(id)).content).toBe('Safe');
    await expect(files.read('external:bad')).rejects.toMatchObject({ code: 'file-invalid-name' });
    await expect(files.read(externalFileId({ rootId: root.id, path: '../outside.md' }))).rejects.toMatchObject({ code: 'file-unauthorized' });
    await expect(files.read(externalFileId({ rootId: 'missing', path: 'note.md' }))).rejects.toMatchObject({ code: 'file-not-found' });
    await explorer.disconnect(root.id);
    await expect(files.read(id)).rejects.toMatchObject({ code: 'file-not-found' });
  } finally { explorer.close(); rmSync(directory, { recursive: true, force: true }); }
});
