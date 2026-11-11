import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultConversationStore, workspaceConversationPlacement } from '@office/chat/service';
import { createVaultWorkspaceStore } from '@office/workspace/service';
import { createVaultRichDocumentStore } from '@office/editor/rich-document-service';
import { createRichDocument } from '@office/editor/rich-document-domain';
import { createFilesystemExplorer } from '@office/files/service';
import { createExplorerRoutes } from '../../../apps/service/src/explorer.route';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-explorer-routes-'));
  process.env.AIR_VAULT_ROOT = root;
  const connectedPath = join(root, 'external');
  const connectedPathB = join(root, 'external-b');
  mkdirSync(connectedPath);
  mkdirSync(connectedPathB);
  const conversations = createVaultConversationStore(root);
  const workspace = createVaultWorkspaceStore({ vaultRoot: root, conversations: workspaceConversationPlacement(conversations) });
  const notes = createVaultRichDocumentStore(root);
  const filesystem = createFilesystemExplorer({ databasePath: join(root, 'files.sqlite') });
  const route = createExplorerRoutes(workspace, filesystem);
  const send = async (path: string, method = 'GET', body?: unknown): Promise<Response> => {
    const response = await route(new Request(`http://127.0.0.1${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }));
    if (!response) throw new Error('Expected the explorer router to handle this request.');
    return response;
  };
  return {
    root, connectedPath, connectedPathB, conversations, workspace, notes, filesystem, route, send,
    close: () => { workspace.close(); notes.close(); conversations.close(); filesystem.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('disconnecting the last mount revokes file access while preserving disk contents and shared mounts', async () => {
  const f = fixture();
  try {
    const root = await f.filesystem.connect({ path: f.connectedPath });
    await f.filesystem.create({ rootId: root.id, parentPath: '', name: 'keep.txt', kind: 'file' });
    const program = f.workspace.create({ id: 'program', kind: 'program', name: 'Program' });
    const first = f.workspace.create({ id: 'first', kind: 'mount', name: 'First shortcut', parentId: program.id, rootId: root.id });
    const second = f.workspace.create({ id: 'second', kind: 'mount', name: 'Second shortcut', parentId: program.id, rootId: root.id });
    expect((await f.send(`/api/v1/workspace/nodes/${encodeURIComponent(first.id)}`, 'DELETE', { policy: 'keep-chats' })).status).toBe(200);
    expect(f.filesystem.roots()).toHaveLength(1);
    expect((await f.filesystem.read({ rootId: root.id, path: 'keep.txt' })).content).toBe('');
    expect((await f.send(`/api/v1/workspace/nodes/${encodeURIComponent(second.id)}`, 'DELETE', { policy: 'keep-chats' })).status).toBe(200);
    expect(f.filesystem.roots()).toHaveLength(0);
    await expect(f.filesystem.read({ rootId: root.id, path: 'keep.txt' })).rejects.toThrow();
    expect(existsSync(join(f.connectedPath, 'keep.txt'))).toBe(true);
    expect((await f.filesystem.connect({ path: f.connectedPath })).id).toBe(root.id);
  } finally { f.close(); }
});

test('explorer routes create programs and nested note references, move recent chats, and preserve contents when removing organization', async () => {
  const f = fixture();
  try {
    const programResponse = await f.send('/api/v1/workspace/nodes', 'POST', { id: 'p', kind: 'program', name: 'Research', instruction: 'Use evidence.' });
    expect(programResponse.status).toBe(201);
    const program = (await programResponse.json() as { node: { id: string } }).node;
    const evidence = f.notes.save(createRichDocument('Evidence', 'doc-1'));
    const details = f.notes.save({ ...createRichDocument('Details', 'doc-2'), title: 'Details' });
    const noteResponse = await f.send('/api/v1/workspace/nodes', 'POST', { id: 'note', kind: 'note', parentId: program.id, targetId: evidence.path ?? evidence.id, name: 'Evidence', instruction: 'Cite sources.' });
    expect(noteResponse.status).toBe(201);
    const note = (await noteResponse.json() as { node: { id: string; targetId: string } }).node;
    expect(note.targetId).toMatch(/\.note\.json$/);
    expect((await f.send('/api/v1/workspace/nodes', 'POST', { id: 'child', kind: 'note', parentId: note.id, targetId: details.path ?? details.id, name: 'Details' })).status).toBe(201);
    f.conversations.ensure('chat');
    expect((await f.send('/api/v1/workspace/move-chats', 'POST', { ids: ['chat'], parentId: note.id })).status).toBe(200);
    expect(f.conversations.load('chat')?.conversation.folderId).toBe(note.id);
    expect(f.workspace.instruction('chat')).toContain('Use evidence.');
    const duplicate = await f.send('/api/v1/workspace/nodes', 'POST', { id: 'duplicate', kind: 'program', name: 'research' });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'An item with this name already exists here.', code: 'duplicate' });
    expect((await f.send('/api/v1/workspace/nodes/missing', 'PATCH', { name: 'Name' })).status).toBe(404);
    expect((await f.send(`/api/v1/workspace/nodes/${encodeURIComponent(program.id)}`, 'DELETE', { policy: 'keep-chats' })).status).toBe(200);
    expect(f.conversations.load('chat')?.conversation.folderId).toBeNull();
    const retained = f.workspace.list().find((node) => node.kind === 'note' && node.name === 'Evidence');
    expect(retained).toMatchObject({ kind: 'note', parentId: 'program:general' });
    expect(retained?.kind === 'note' ? retained.targetId : '').toMatch(/programs\/general\/notes\/.+\.note\.json$/);
    expect(await f.route(new Request('http://127.0.0.1/api/v1/unrelated'))).toBeNull();
  } finally { f.close(); }
});

test('external explorer routes connect a real folder, edit nested files, reject stale saves, move, trash and restore', async () => {
  const f = fixture();
  try {
    expect((await f.send('/api/v1/external/roots', 'POST', { path: f.connectedPath, name: 'Repository' })).status).toBe(201);
    const [root] = f.filesystem.roots();
    if (!root) throw new Error('Expected a connected folder.');
    expect((await f.send('/api/v1/external/roots')).status).toBe(200);
    const programResponse = await f.send('/api/v1/workspace/nodes', 'POST', { id: 'p', kind: 'program', name: 'Code' });
    expect(programResponse.status).toBe(201);
    const program = (await programResponse.json() as { node: { id: string } }).node;
    expect((await f.send('/api/v1/workspace/nodes', 'POST', { id: 'mount', kind: 'mount', parentId: program.id, rootId: root.id, name: 'Repository' })).status).toBe(201);
    expect((await f.send('/api/v1/external/entries', 'POST', { rootId: root.id, parentPath: '', name: 'src', kind: 'directory' })).status).toBe(201);
    expect((await f.send('/api/v1/external/entries', 'POST', { rootId: root.id, parentPath: 'src', name: 'main.ts', kind: 'file' })).status).toBe(201);
    const query = `rootId=${encodeURIComponent(root.id)}&path=src%2Fmain.ts`;
    const original = await f.filesystem.read({ rootId: root.id, path: 'src/main.ts' });
    expect((await f.send(`/api/v1/external/text?${query}`)).status).toBe(200);
    expect((await f.send(`/api/v1/external/text?${query}`, 'PUT', { content: 'export const answer = 42;\n', expectedVersion: original.version })).status).toBe(200);
    expect(readFileSync(join(f.connectedPath, 'src', 'main.ts'), 'utf8')).toBe('export const answer = 42;\n');
    expect((await f.send(`/api/v1/external/text?${query}`, 'PUT', { content: 'stale overwrite', expectedVersion: original.version })).status).toBe(409);
    expect(await (await f.send(`/api/v1/external/children?rootId=${root.id}&path=src`)).json()).toMatchObject({ entries: [{ name: 'main.ts', kind: 'file', path: 'src/main.ts' }] });
    expect((await f.send('/api/v1/external/transfer', 'POST', { rootId: root.id, path: 'src/main.ts', destinationPath: 'src/renamed.ts', operation: 'move' })).status).toBe(200);
    expect((await f.send('/api/v1/external/trash', 'POST', { rootId: root.id, path: 'src/renamed.ts' })).status).toBe(200);
    const [trashed] = f.filesystem.trashEntries(root.id);
    if (!trashed) throw new Error('Expected a recoverable trash entry.');
    expect((await f.send(`/api/v1/external/trash?rootId=${root.id}`)).status).toBe(200);
    expect((await f.send('/api/v1/external/restore', 'POST', { id: trashed.id })).status).toBe(200);
    expect(readFileSync(join(f.connectedPath, 'src', 'renamed.ts'), 'utf8')).toBe('export const answer = 42;\n');
    const missing = await f.send(`/api/v1/external/text?rootId=${root.id}&path=missing.txt`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'This file no longer exists.', code: 'not-found' });
    expect((await f.send(`/api/v1/external/children?rootId=${root.id}&path=..`)).status).toBe(403);
    expect((await f.send(`/api/v1/external/roots/${root.id}`, 'DELETE')).status).toBe(200);
    expect(f.filesystem.roots()).toEqual([]);
    expect(f.workspace.list().some((node) => node.kind === 'mount' && node.rootId === root.id)).toBe(false);
    expect(readFileSync(join(f.connectedPath, 'src', 'renamed.ts'), 'utf8')).toContain('42');
  } finally { f.close(); }
});

test('external upload and download preserve arbitrary binary files without converting them into notes', async () => {
  const f = fixture();
  try {
    const root = await f.filesystem.connect({ path: f.connectedPath });
    const bytes = new Uint8Array([0, 1, 255, 128, 42]);
    const uploaded = await f.route(new Request(`http://127.0.0.1/api/v1/external/upload?rootId=${root.id}&path=&name=sample.bin`, { method: 'POST', body: bytes }));
    expect(uploaded?.status).toBe(201);
    expect(new Uint8Array(readFileSync(join(f.connectedPath, 'sample.bin')))).toEqual(bytes);
    const download = await f.send(`/api/v1/external/download?rootId=${root.id}&path=sample.bin`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    expect(download.headers.get('Content-Disposition')).toContain('sample.bin');
    const text = await f.send(`/api/v1/external/text?rootId=${root.id}&path=sample.bin`);
    expect(text.status).toBe(400);
    expect(await text.json()).toEqual({ error: 'This is a binary file. Download it or open it in a compatible application.', code: 'unsupported' });
    expect(f.workspace.list().some((node) => node.kind === 'mount')).toBe(false);
  } finally { f.close(); }
});

test('mixed organization moves nodes, recent chats and unfiled notes atomically and rolls back conflicts', async () => {
  const f = fixture();
  try {
    const source = f.workspace.create({ id: 'source', kind: 'program', name: 'Source' });
    const destination = f.workspace.create({ id: 'destination', kind: 'program', name: 'Destination' });
    const folder = f.workspace.create({ id: 'folder', kind: 'folder', name: 'Folder', parentId: source.id });
    f.conversations.ensure('chat');
    const filed = f.notes.save(createRichDocument('Note', 'doc'));
    const duplicateA = f.notes.save(createRichDocument('Duplicate A', 'doc-a'));
    const duplicateB = f.notes.save(createRichDocument('Duplicate B', 'doc-b'));
    const filedTarget = filed.path ?? filed.id;
    const invalidChat = await f.send('/api/v1/workspace/organize', 'POST', {
      ids: [folder.id], chatIds: ['chat', 'missing'], notes: [{ id: 'note', targetId: filedTarget, name: 'Note' }], parentId: destination.id
    });
    expect(invalidChat.status).toBe(404);
    expect(f.workspace.get(folder.id)?.parentId).toBe(source.id);
    expect(f.conversations.load('chat')?.conversation.folderId).toBeNull();
    const conflict = await f.send('/api/v1/workspace/organize', 'POST', {
      ids: [folder.id], chatIds: ['chat'], notes: [{ id: 'note-a', targetId: duplicateA.path ?? duplicateA.id, name: 'Duplicate' }, { id: 'note-b', targetId: duplicateB.path ?? duplicateB.id, name: 'duplicate' }], parentId: destination.id
    });
    expect(conflict.status).toBe(409);
    expect(f.workspace.get(folder.id)?.parentId).toBe(source.id);
    const success = await f.send('/api/v1/workspace/organize', 'POST', {
      ids: [folder.id, folder.id], chatIds: ['chat', 'chat'], notes: [{ id: 'note', targetId: filedTarget, name: 'Note' }], parentId: destination.id, beforeId: null
    });
    expect(success.status).toBe(200);
    const movedFolder = f.workspace.list().find((node) => node.kind === 'folder' && node.name === 'Folder');
    expect(movedFolder?.parentId).toBe(destination.id);
    expect(f.workspace.get(folder.id)).toBeNull();
    const filedNode = f.workspace.list().find((node) => node.kind === 'note' && node.name === 'Note');
    expect(filedNode).toMatchObject({ parentId: destination.id });
    expect(filedNode?.kind === 'note' ? filedNode.targetId : '').toMatch(/\.note\.json$/);
    expect(f.conversations.load('chat')?.conversation.folderId).toBe(destination.id);
    const currentTarget = filedNode && filedNode.kind === 'note' ? filedNode.targetId : filedTarget;
    const racedRegistration = await f.send('/api/v1/workspace/organize', 'POST', {
      ids: [], chatIds: [], notes: [{ id: 'raced-id', targetId: currentTarget, name: 'Stale local name' }], parentId: source.id
    });
    expect(racedRegistration.status).toBe(200);
    const relocated = f.workspace.list().find((node) => node.kind === 'note' && (node.targetId === currentTarget || node.name === 'Stale local name' || node.name === 'Note'));
    expect(relocated).toMatchObject({ parentId: source.id });
  } finally { f.close(); }
});
