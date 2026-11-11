import type { WorkspaceStore, WorkspaceNodeInput, WorkspaceNodeUpdate } from '@office/workspace/service';
import { WorkspaceError } from '@office/workspace/service';
import { FilesystemExplorerError, type FilesystemExplorer } from '@office/files/service';

export function removeWorkspaceItem(workspace: WorkspaceStore, filesystem: FilesystemExplorer, id: string, policy: 'keep-chats' | 'delete-chats') {
  const removed = workspace.remove(id, policy);
  if (removed) for (const rootId of removed.rootIds) {
    if (!workspace.list().some((node) => node.kind === 'mount' && node.rootId === rootId)) filesystem.disconnect(rootId);
  }
  return removed;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid operation details.');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A text value is required.');
  return value;
}
function parent(value: unknown): string | null { return value === null ? null : text(value); }
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) throw new Error('Choose valid items.');
  return value;
}

export function createExplorerRoutes(workspace: WorkspaceStore, filesystem: FilesystemExplorer) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/workspace/') && !url.pathname.startsWith('/api/v1/external/')) return null;
    try {
      const path = url.pathname;
      const scopeFolder = path.match(/^\/api\/v1\/workspace\/scopes\/([^/]+)\/folders$/);
      if (scopeFolder && request.method === 'POST') {
        const scope = workspace.get(decodeURIComponent(scopeFolder[1] ?? ''));
        if (!scope || (scope.kind !== 'program' && scope.kind !== 'project')) throw new WorkspaceError('Choose a program or project for this folder.', 'invalid-parent');
        const body = record(await request.json());
        const previous = new Set(filesystem.roots().map((root) => root.id));
        const root = await filesystem.connect({ path: text(body.path) });
        try {
          const existing = workspace.list().find((node) => node.kind === 'mount' && node.rootId === root.id && node.parentId === scope.id);
          const node = existing ?? workspace.create({ id: crypto.randomUUID(), kind: 'mount', parentId: scope.id, rootId: root.id, name: root.name });
          return Response.json({ root, node }, { status: existing ? 200 : 201 });
        } catch (error) {
          if (!previous.has(root.id) && !workspace.list().some((node) => node.kind === 'mount' && node.rootId === root.id)) filesystem.disconnect(root.id);
          throw error;
        }
      }
      if (path === '/api/v1/workspace/nodes' && request.method === 'GET') {
        const connected = new Set(filesystem.roots().map((root) => root.id));
        for (const node of workspace.list()) if (node.kind === 'mount' && !connected.has(node.rootId)) workspace.remove(node.id, 'keep-chats');
        return Response.json({ nodes: workspace.list() });
      }
      if (path === '/api/v1/workspace/nodes' && request.method === 'POST') {
        const body = record(await request.json());
        const common = { id: text(body.id), name: text(body.name), instruction: body.instruction === undefined ? '' : text(body.instruction) };
        let input: WorkspaceNodeInput;
        if (body.kind === 'program') input = { ...common, kind: 'program' };
        else if (body.kind === 'project') input = { ...common, kind: 'project', ...(body.parentId === undefined ? {} : { parentId: parent(body.parentId) }) };
        else if (body.kind === 'folder') input = { ...common, kind: 'folder', parentId: text(body.parentId) };
        else if (body.kind === 'note') input = { ...common, kind: 'note', parentId: parent(body.parentId), targetId: text(body.targetId) };
        else if (body.kind === 'mount') input = { ...common, kind: 'mount', parentId: parent(body.parentId), rootId: text(body.rootId) };
        else throw new Error('Choose a valid item type.');
        return Response.json({ node: workspace.create(input) }, { status: 201 });
      }
      const nodePath = path.match(/^\/api\/v1\/workspace\/nodes\/([^/]+)$/);
      if (nodePath) {
        const id = decodeURIComponent(nodePath[1]!);
        if (request.method === 'PATCH') {
          const body = record(await request.json());
          const update: WorkspaceNodeUpdate = {};
          if (body.name !== undefined) update.name = text(body.name);
          if (body.instruction !== undefined) update.instruction = text(body.instruction);
          if (body.parentId !== undefined) update.parentId = parent(body.parentId);
          const node = workspace.update(id, update);
          return node ? Response.json({ node }) : Response.json({ error: 'This item no longer exists.' }, { status: 404 });
        }
        if (request.method === 'DELETE') {
          const body = record(await request.json());
          if (body.policy !== 'keep-chats' && body.policy !== 'delete-chats') throw new Error('Choose whether to keep or delete chats.');
          const removed = removeWorkspaceItem(workspace, filesystem, id, body.policy);
          return removed ? Response.json({ removed }) : Response.json({ error: 'This item no longer exists.' }, { status: 404 });
        }
      }
      if (path === '/api/v1/workspace/move' && request.method === 'POST') {
        const body = record(await request.json());
        return Response.json({ nodes: workspace.moveMany({ ids: strings(body.ids), parentId: parent(body.parentId), beforeId: body.beforeId === undefined ? undefined : parent(body.beforeId) }) });
      }
      if (path === '/api/v1/workspace/move-chats' && request.method === 'POST') {
        const body = record(await request.json());
        workspace.moveChats({ ids: strings(body.ids), parentId: parent(body.parentId) });
        return Response.json({ moved: true });
      }
      if (path === '/api/v1/workspace/organize' && request.method === 'POST') {
        const body = record(await request.json());
        if (!Array.isArray(body.notes)) throw new Error('Choose valid notes.');
        const notes = body.notes.map((value: unknown) => {
          const note = record(value);
          return { id: text(note.id), targetId: text(note.targetId), name: text(note.name) };
        });
        return Response.json({ nodes: workspace.organize({ ids: strings(body.ids), chatIds: strings(body.chatIds), notes, parentId: parent(body.parentId), beforeId: body.beforeId === undefined ? undefined : parent(body.beforeId) }) });
      }
      if (path === '/api/v1/external/roots') {
        if (request.method === 'GET') return Response.json({ roots: filesystem.roots() });
        if (request.method === 'POST') {
          const body = record(await request.json());
          return Response.json({ root: await filesystem.connect({ path: text(body.path), ...(body.name === undefined ? {} : { name: text(body.name) }) }) }, { status: 201 });
        }
      }
      const rootPath = path.match(/^\/api\/v1\/external\/roots\/([^/]+)$/);
      if (rootPath && request.method === 'DELETE') {
        const rootId = decodeURIComponent(rootPath[1]!);
        filesystem.disconnect(rootId);
        for (const node of workspace.list()) if (node.kind === 'mount' && node.rootId === rootId) workspace.remove(node.id, 'keep-chats');
        return Response.json({ disconnected: true });
      }
      const target = () => ({ rootId: text(url.searchParams.get('rootId')), path: text(url.searchParams.get('path') ?? '') });
      if (path === '/api/v1/external/children' && request.method === 'GET') return Response.json({ entries: await filesystem.list(target()) });
      if (path === '/api/v1/external/text') {
        if (request.method === 'GET') return Response.json({ file: await filesystem.read(target()) });
        if (request.method === 'PUT') {
          const body = record(await request.json());
          return Response.json({ file: await filesystem.save({ ...target(), content: text(body.content), expectedVersion: text(body.expectedVersion) }) });
        }
      }
      if (path === '/api/v1/external/entries' && request.method === 'POST') {
        const body = record(await request.json());
        if (body.kind !== 'file' && body.kind !== 'directory') throw new Error('Choose file or folder.');
        return Response.json({ entry: await filesystem.create({ rootId: text(body.rootId), parentPath: text(body.parentPath), name: text(body.name), kind: body.kind }) }, { status: 201 });
      }
      if (path === '/api/v1/external/transfer' && request.method === 'POST') {
        const body = record(await request.json());
        if (body.operation !== 'move' && body.operation !== 'copy') throw new Error('Choose move or copy.');
        return Response.json({ entry: await filesystem.transfer({ rootId: text(body.rootId), path: text(body.path), destinationPath: text(body.destinationPath), operation: body.operation, ...(body.destinationRootId === undefined ? {} : { destinationRootId: text(body.destinationRootId) }) }) });
      }
      if (path === '/api/v1/external/trash') {
        if (request.method === 'GET') return Response.json({ entries: filesystem.trashEntries(text(url.searchParams.get('rootId'))) });
        if (request.method === 'POST') {
          const body = record(await request.json());
          return Response.json({ entry: await filesystem.trash({ rootId: text(body.rootId), path: text(body.path) }) });
        }
      }
      if (path === '/api/v1/external/restore' && request.method === 'POST') {
        const body = record(await request.json());
        return Response.json({ entry: await filesystem.restore(text(body.id)) });
      }
      if (path === '/api/v1/external/download' && request.method === 'GET') {
        const { name, bytes } = await filesystem.download(target());
        const type = /\.pdf$/i.test(name) ? 'application/pdf'
          : /\.png$/i.test(name) ? 'image/png'
          : /\.jpe?g$/i.test(name) ? 'image/jpeg'
          : /\.gif$/i.test(name) ? 'image/gif'
          : /\.webp$/i.test(name) ? 'image/webp'
          : /\.svg$/i.test(name) ? 'image/svg+xml'
          : 'application/octet-stream';
        return new Response(new Blob([new Uint8Array(bytes)], { type }), { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
      }
      if (path === '/api/v1/external/upload' && request.method === 'POST') {
        return Response.json({ entry: await filesystem.upload({ rootId: text(url.searchParams.get('rootId')), parentPath: text(url.searchParams.get('path') ?? ''), name: text(url.searchParams.get('name')), bytes: new Uint8Array(await request.arrayBuffer()) }) }, { status: 201 });
      }
      return Response.json({ error: 'Unknown explorer operation.' }, { status: 404 });
    } catch (error) {
      const code = error instanceof WorkspaceError || error instanceof FilesystemExplorerError ? error.code : 'invalid';
      const status = code === 'not-found' || code === 'missing' ? 404 : code === 'conflict' || code === 'duplicate' ? 409 : code === 'unauthorized' ? 403 : code === 'too-large' ? 413 : 400;
      const message = error instanceof WorkspaceError || error instanceof FilesystemExplorerError ? error.message : 'The explorer operation could not be completed.';
      return Response.json({ error: message, code }, { status });
    }
  };
}
