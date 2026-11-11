import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilesystemExplorer } from '../../../packages/files/src/filesystem-explorer.service.public';
import { FilesystemExplorerError } from '../../../packages/files/src/filesystem-explorer.domain.public';

function fixture(options: { maxBytes?: number; maxTextBytes?: number } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'office-explorer-'));
  const root = join(directory, 'root');
  mkdirSync(root);
  const databasePath = join(directory, 'private', 'roots.sqlite');
  const store = createFilesystemExplorer({ databasePath, ...options });
  return { directory, root, databasePath, store, dispose() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('lazy listings retain nested relative identities and show binary and extensionless files', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, 'docs')); mkdirSync(join(f.root, 'code'));
    writeFileSync(join(f.root, 'docs', 'README.md'), 'Documentation');
    writeFileSync(join(f.root, 'code', 'README.md'), 'Code');
    writeFileSync(join(f.root, 'image.bin'), new Uint8Array([0, 255, 17]));
    writeFileSync(join(f.root, 'LICENSE'), 'License');
    const root = await f.store.connect({ path: f.root });
    expect((await f.store.list({ rootId: root.id, path: '' })).map((entry) => entry.name)).toEqual(['code', 'docs', 'image.bin', 'LICENSE']);
    expect((await f.store.list({ rootId: root.id, path: 'docs' })).map((entry) => entry.path)).toEqual(['docs/README.md']);
    expect(await f.store.read({ rootId: root.id, path: 'docs/README.md' })).toMatchObject({ id: 'docs/README.md', content: 'Documentation' });
    expect(await f.store.read({ rootId: root.id, path: 'code/README.md' })).toMatchObject({ id: 'code/README.md', content: 'Code' });
    expect(await f.store.read({ rootId: root.id, path: 'LICENSE' })).toMatchObject({ content: 'License' });
    await expect(f.store.read({ rootId: root.id, path: 'image.bin' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(Array.from((await f.store.download({ rootId: root.id, path: 'image.bin' })).bytes)).toEqual([0, 255, 17]);
  } finally { f.dispose(); }
});

test('create, rename, copy, upload and version guarded saves affect the real directory without overwrite', async () => {
  const f = fixture();
  try {
    const root = await f.store.connect({ path: f.root });
    const rootId = root.id;
    await f.store.create({ rootId, parentPath: '', name: 'docs', kind: 'directory' });
    await f.store.create({ rootId, parentPath: 'docs', name: 'note.md', kind: 'file' });
    const first = await f.store.read({ rootId, path: 'docs/note.md' });
    const saved = await f.store.save({ rootId, path: first.id, content: 'Saved text', expectedVersion: first.version });
    expect(readFileSync(join(f.root, 'docs', 'note.md'), 'utf8')).toBe('Saved text');
    writeFileSync(join(f.root, 'docs', 'note.md'), 'External text');
    await expect(f.store.save({ rootId, path: first.id, content: 'Overwrite', expectedVersion: saved.version })).rejects.toMatchObject({ code: 'conflict' });
    expect(readFileSync(join(f.root, 'docs', 'note.md'), 'utf8')).toBe('External text');
    await f.store.transfer({ rootId, path: first.id, destinationPath: 'docs/renamed.md', operation: 'move' });
    await f.store.transfer({ rootId, path: 'docs', destinationPath: 'copy', operation: 'copy' });
    expect(readFileSync(join(f.root, 'copy', 'renamed.md'), 'utf8')).toBe('External text');
    await expect(f.store.transfer({ rootId, path: 'docs/renamed.md', destinationPath: 'copy/renamed.md', operation: 'move' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.store.transfer({ rootId, path: 'docs', destinationPath: 'docs/descendant', operation: 'move' })).rejects.toMatchObject({ code: 'invalid' });
    await f.store.upload({ rootId, parentPath: 'docs', name: 'binary.dat', bytes: new Uint8Array([0, 1, 2]) });
    expect(Array.from(readFileSync(join(f.root, 'docs', 'binary.dat')))).toEqual([0, 1, 2]);
    await expect(f.store.upload({ rootId, parentPath: 'docs', name: 'binary.dat', bytes: new Uint8Array([3]) })).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.store.create({ rootId, parentPath: '', name: 'CON.txt', kind: 'file' })).rejects.toMatchObject({ code: 'invalid' });
  } finally { f.dispose(); }
});

test('trash is recoverable after restart and disconnect preserves disk data and stable root identity', async () => {
  const f = fixture();
  let reopened: ReturnType<typeof createFilesystemExplorer> | undefined;
  try {
    mkdirSync(join(f.root, 'docs')); writeFileSync(join(f.root, 'docs', 'note.md'), 'Preserved');
    const root = await f.store.connect({ path: f.root, name: 'Repository' });
    const deleted = await f.store.trash({ rootId: root.id, path: 'docs' });
    expect(await f.store.list({ rootId: root.id, path: '' })).toEqual([]);
    await expect(f.store.read({ rootId: root.id, path: '.air-office-trash/anything' })).rejects.toMatchObject({ code: 'unauthorized' });
    f.store.disconnect(root.id);
    expect(f.store.roots()).toEqual([]);
    f.store.close();
    reopened = createFilesystemExplorer({ databasePath: f.databasePath });
    const restoredRoot = await reopened.connect({ path: f.root });
    expect(restoredRoot.id).toBe(root.id);
    expect(reopened.trashEntries(root.id)).toEqual([deleted]);
    expect(await reopened.restore(deleted.id)).toMatchObject({ path: 'docs', kind: 'directory' });
    expect(readFileSync(join(f.root, 'docs', 'note.md'), 'utf8')).toBe('Preserved');
    expect(reopened.trashEntries(root.id)).toEqual([]);
    reopened.disconnect(root.id);
    expect(readFileSync(join(f.root, 'docs', 'note.md'), 'utf8')).toBe('Preserved');
  } finally { reopened?.close(); rmSync(f.directory, { recursive: true, force: true }); }
});

test('restore conflicts preserve both current and recoverable files', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'note.md'), 'Original');
    const root = await f.store.connect({ path: f.root });
    const item = await f.store.trash({ rootId: root.id, path: 'note.md' });
    writeFileSync(join(f.root, 'note.md'), 'Replacement');
    await expect(f.store.restore(item.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('Replacement');
    expect(f.store.trashEntries(root.id)).toEqual([item]);
  } finally { f.dispose(); }
});

test('traversal, absolute paths, disconnected roots and root mutations are rejected', async () => {
  const f = fixture();
  try {
    const root = await f.store.connect({ path: f.root });
    for (const path of ['', '../outside', '/absolute', 'C:/Windows/test', 'a/../b', 'a\\..\\b']) {
      await expect(f.store.trash({ rootId: root.id, path })).rejects.toBeInstanceOf(FilesystemExplorerError);
    }
    await expect(f.store.create({ rootId: root.id, parentPath: '../outside', name: 'x', kind: 'directory' })).rejects.toMatchObject({ code: 'unauthorized' });
    f.store.disconnect(root.id);
    await expect(f.store.list({ rootId: root.id, path: '' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(f.store.connect({ path: join(f.root, 'missing') })).rejects.toMatchObject({ code: 'not-found' });
  } finally { f.dispose(); }
});

test('byte limits and invalid UTF-8 fail explicitly', async () => {
  const f = fixture({ maxBytes: 8, maxTextBytes: 4 });
  try {
    const root = await f.store.connect({ path: f.root });
    writeFileSync(join(f.root, 'invalid.txt'), new Uint8Array([255, 255]));
    writeFileSync(join(f.root, 'large.txt'), '123456789');
    await expect(f.store.read({ rootId: root.id, path: 'invalid.txt' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(f.store.download({ rootId: root.id, path: 'large.txt' })).rejects.toMatchObject({ code: 'too-large' });
    await expect(f.store.upload({ rootId: root.id, parentPath: '', name: 'upload.txt', bytes: new Uint8Array(9) })).rejects.toMatchObject({ code: 'too-large' });
  } finally { f.dispose(); }
});

test('symlinks are visible but cannot expose or mutate external targets', async () => {
  const f = fixture();
  try {
    const outside = join(f.directory, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'private.md'), 'Private');
    // A Windows junction requires no symbolic-link privilege and exercises realpath confinement.
    symlinkSync(outside, join(f.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const root = await f.store.connect({ path: f.root });
    expect(await f.store.list({ rootId: root.id, path: '' })).toMatchObject([{ name: 'escape', kind: 'symlink' }]);
    await expect(f.store.list({ rootId: root.id, path: 'escape' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(f.store.read({ rootId: root.id, path: 'escape/private.md' })).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(f.store.upload({ rootId: root.id, parentPath: 'escape', name: 'owned.md', bytes: new Uint8Array() })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(readFileSync(join(outside, 'private.md'), 'utf8')).toBe('Private');
  } finally { f.dispose(); }
});

test('cross-root copies preserve binary bytes and moves retain recoverable nested source data', async () => {
  const f = fixture();
  try {
    const destinationPath = join(f.directory, 'destination'); mkdirSync(destinationPath);
    mkdirSync(join(f.root, 'nested')); writeFileSync(join(f.root, 'nested', 'image.bin'), new Uint8Array([0, 255, 42]));
    const source = await f.store.connect({ path: f.root });
    const destination = await f.store.connect({ path: destinationPath });
    expect(await f.store.transfer({ rootId: source.id, path: 'nested/image.bin', destinationRootId: destination.id, destinationPath: 'copy.bin', operation: 'copy' })).toMatchObject({ rootId: destination.id, path: 'copy.bin' });
    expect(Array.from(readFileSync(join(destinationPath, 'copy.bin')))).toEqual([0, 255, 42]);
    expect(Array.from(readFileSync(join(f.root, 'nested', 'image.bin')))).toEqual([0, 255, 42]);
    await f.store.transfer({ rootId: source.id, path: 'nested', destinationRootId: destination.id, destinationPath: 'moved', operation: 'move' });
    expect((await f.store.list({ rootId: source.id, path: '' })).map((entry) => entry.name)).toEqual([]);
    expect(Array.from(readFileSync(join(destinationPath, 'moved', 'image.bin')))).toEqual([0, 255, 42]);
    const trashed = f.store.trashEntries(source.id);
    expect(trashed.map((item) => item.originalPath)).toEqual(['nested']);
    const item = trashed[0];
    if (!item) throw new Error('Missing recoverable source.');
    await f.store.restore(item.id);
    expect(Array.from(readFileSync(join(f.root, 'nested', 'image.bin')))).toEqual([0, 255, 42]);
    await expect(f.store.transfer({ rootId: source.id, path: 'nested', destinationRootId: destination.id, destinationPath: 'moved', operation: 'copy' })).rejects.toMatchObject({ code: 'conflict' });
  } finally { f.dispose(); }
});

test('cross-root aliases cannot copy or move a directory into its actual descendants', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, 'docs')); mkdirSync(join(f.root, 'docs', 'inside'));
    const outer = await f.store.connect({ path: f.root });
    const inner = await f.store.connect({ path: join(f.root, 'docs') });
    for (const operation of ['move', 'copy'] satisfies Array<'move' | 'copy'>) {
      await expect(f.store.transfer({ rootId: outer.id, path: 'docs', destinationRootId: inner.id, destinationPath: 'inside/recursive', operation })).rejects.toMatchObject({ code: 'invalid' });
      await expect(f.store.transfer({ rootId: outer.id, path: 'docs/inside', destinationRootId: inner.id, destinationPath: 'inside', operation })).rejects.toMatchObject({ code: 'invalid' });
    }
    expect((await f.store.list({ rootId: inner.id, path: '' })).map((entry) => entry.name)).toEqual(['inside']);
  } finally { f.dispose(); }
});

test('cross-root source cleanup failure leaves destination and original data intact with a clear error', async () => {
  const f = fixture();
  try {
    const destinationPath = join(f.directory, 'destination'); mkdirSync(destinationPath);
    writeFileSync(join(f.root, 'note.md'), 'Keep both');
    // An incompatible recovery entry makes the source trash operation fail after destination publication.
    writeFileSync(join(f.root, '.air-office-trash'), 'Blocked recovery directory');
    const source = await f.store.connect({ path: f.root });
    const destination = await f.store.connect({ path: destinationPath });
    await expect(f.store.transfer({ rootId: source.id, path: 'note.md', destinationRootId: destination.id, destinationPath: 'note.md', operation: 'move' })).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('destination copy was saved') });
    expect(readFileSync(join(f.root, 'note.md'), 'utf8')).toBe('Keep both');
    expect(readFileSync(join(destinationPath, 'note.md'), 'utf8')).toBe('Keep both');
    expect(f.store.trashEntries(source.id)).toEqual([]);
  } finally { f.dispose(); }
});
