import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import type { WorkspaceStore } from '@office/workspace/service';
import type { FilesystemExplorer } from '@office/files/service';
import type { DocumentsService } from '@office/documents/service';
import type { KnowledgeService } from '@office/knowledge/service';
import type { RichDocument } from '@office/editor/rich-document-domain';
import { exportRichDocument } from '@office/editor/rich-document-domain';

const identity = (value: string) => createHash('sha256').update(value).digest('hex');
export const scopeCollectionId = (id: string) => `workspace:${identity(id)}`;

export function inheritedScopeCollections(workspace: WorkspaceStore, scopeId: string | null): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let node = scopeId ? workspace.get(scopeId) : null;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    ids.unshift(scopeCollectionId(node.id));
    node = node.parentId ? workspace.get(node.parentId) : null;
  }
  return ids;
}

export function readableScopeVersions(workspace: WorkspaceStore, filesystem: FilesystemExplorer, documents: DocumentsService, scopeId: string | null): string[] {
  const collections = new Set(inheritedScopeCollections(workspace, scopeId));
  const nodes = workspace.list();
  const roots = new Set(filesystem.roots().map((root) => root.id));
  const versions: string[] = [];
  for (const scope of nodes.filter((node) => collections.has(scopeCollectionId(node.id)))) {
    const members = new Set([scope.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const node of nodes) if (node.parentId && members.has(node.parentId) && node.kind !== 'project' && !members.has(node.id)) { members.add(node.id); changed = true; }
    }
    const material = nodes.filter((node) => members.has(node.id));
    for (const document of documents.documents(scopeCollectionId(scope.id))) {
      const allowed = material.some((node) => {
        if (node.kind === 'note') return document.id === `scope-source:${identity(`${scope.id}:note:${node.targetId}`)}`;
        if (node.kind !== 'mount' || !roots.has(node.rootId) || !document.name.startsWith(`${node.name}/`)) return false;
        const path = document.name.slice(node.name.length + 1);
        return document.id === `scope-source:${identity(`${scope.id}:file:${node.rootId}:${path}`)}`;
      });
      if (allowed) versions.push(...documents.versions(document.id).map((version) => version.id));
    }
  }
  return versions;
}

export function createWorkspaceKnowledgeRoutes(deps: {
  workspace: WorkspaceStore; filesystem: FilesystemExplorer; documents: DocumentsService;
  knowledge: () => KnowledgeService; note: (id: string) => RichDocument | null | Promise<RichDocument | null>;
  index: (input: { collectionId: string; versionId: string; content: string }) => void;
}) {
  const running = new Set<string>();
  const snapshots = new Map<string, Map<string, string>>();
  return async (request: Request): Promise<Response | null> => {
    const match = new URL(request.url).pathname.match(/^\/api\/v1\/workspace\/scopes\/([^/]+)\/(knowledge|material)$/);
    if (!match) return null;
    const id = decodeURIComponent(match[1] ?? '');
    const scope = deps.workspace.get(id);
    if (!scope || (scope.kind !== 'program' && scope.kind !== 'project')) return Response.json({ error: 'Choose an existing program or project.' }, { status: 404 });
    if (match[2] === 'material') {
      if (request.method !== 'GET') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
      const readable = new Set(readableScopeVersions(deps.workspace, deps.filesystem, deps.documents, id));
      const collections = inheritedScopeCollections(deps.workspace, id);
      if (collections.some((collection) => !snapshots.has(collection))) return Response.json({ error: 'Refresh this project and its program sources before reviewing.' }, { status: 409 });
      const sources = collections.flatMap((collection) => deps.documents.documents(collection).flatMap((document) => {
        const versionId = snapshots.get(collection)?.get(document.id);
        const version = versionId && readable.has(versionId) ? deps.documents.version(versionId) : null;
        const artifact = version ? deps.documents.artifact(version.id) : null;
        return version && artifact ? [{ name: document.name, versionId: version.id, text: artifact.text }] : [];
      }));
      const ancestors = [];
      let current = deps.workspace.get(id);
      while (current) { ancestors.unshift(current); current = current.parentId ? deps.workspace.get(current.parentId) : null; }
      if (sources.reduce((length, source) => length + source.text.length, 0) > 190_000) return Response.json({ error: 'This project has more material than one review can accept. Choose a smaller project or review individual documents in Apps.' }, { status: 413 });
      return Response.json({ scopeId: id, name: scope.name, instruction: ancestors.map((node) => node.instruction).filter(Boolean).join('\n\n'), sources });
    }
    const collectionId = scopeCollectionId(id);
    const knowledge = deps.knowledge();
    if (request.method === 'GET') {
      const sources = deps.documents.documents(collectionId);
      return Response.json({ collectionId, inheritedCollectionIds: inheritedScopeCollections(deps.workspace, id), sources, status: knowledge.indexStatus(collectionId), syncing: running.has(id) });
    }
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 });
    if (running.has(id)) return Response.json({ error: 'This material is already being refreshed.' }, { status: 409 });
    running.add(id);
    try {
      knowledge.createCollection(collectionId, scope.name);
      knowledge.updateCollection(collectionId, scope.name, '');
      const imported: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      const activeDocuments = new Set<string>();
      const sourceVersions = new Map<string, string>();
      const ingest = (key: string, name: string, content: string) => {
        if (!content.trim()) { skipped.push({ name, reason: 'No readable text.' }); return; }
        const documentId = `scope-source:${identity(`${id}:${key}`)}`;
        activeDocuments.add(documentId);
        const result = deps.documents.ingest({ documentId, name, collectionId, bytes: new TextEncoder().encode(content) });
        sourceVersions.set(documentId, result.version.id);
        deps.documents.recordArtifact(result.version.id, { extractor: 'workspace-source', extractorVersion: '1', extractionVersion: 'anchor-v1', text: content, pageCount: null, warnings: [], contentHash: result.version.contentHash, createdAt: new Date().toISOString() });
        for (const version of deps.documents.versions(documentId)) if (version.id !== result.version.id) knowledge.removeSource(version.id);
        deps.index({ collectionId, versionId: result.version.id, content });
        imported.push(name);
      };
      let count = 0;
      const walk = async (rootId: string, path: string, label: string) => {
        for (const entry of await deps.filesystem.list({ rootId, path })) {
          if (++count > 1000) throw new Error('This folder exceeds 1,000 entries. Add a smaller folder to choose the material to search.');
          if (entry.name.startsWith('.') || ['node_modules', 'vendor', 'dist', 'build', '__pycache__'].includes(entry.name)) continue;
          if (entry.kind === 'directory') { await walk(rootId, entry.path, label); continue; }
          const name = `${label}/${entry.path}`;
          const key = `file:${rootId}:${entry.path}`;
          if (/\.(pdf|docx|xlsx|pptx|odt|rtf)$/i.test(entry.name)) {
            let scratch: string | null = null;
            try {
              const file = await deps.filesystem.download(entry);
              if (file.bytes.byteLength > 20_000_000) throw new Error('This source exceeds the 20 MB document import limit.');
              const documentId = `scope-source:${identity(`${id}:${key}`)}`;
              const result = deps.documents.ingest({ documentId, name, collectionId, bytes: file.bytes });
              scratch = await mkdtemp(join(tmpdir(), 'air-scope-extract-'));
              const input = join(scratch, `source${extname(entry.name)}`);
              await writeFile(input, file.bytes);
              const artifact = await deps.documents.extract(result.version.id, input);
              if (!artifact.text.trim()) throw new Error('No readable text was extracted.');
              activeDocuments.add(documentId);
              sourceVersions.set(documentId, result.version.id);
              for (const version of deps.documents.versions(documentId)) if (version.id !== result.version.id) knowledge.removeSource(version.id);
              deps.index({ collectionId, versionId: result.version.id, content: artifact.text });
              imported.push(name);
            } catch (error) { skipped.push({ name, reason: error instanceof Error ? error.message : 'Document extraction failed.' }); }
            finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
            continue;
          }
          if (!/\.(md|txt|csv|tsv|json|html?|xml|ya?ml|toml|py|tsx?|jsx?|css|rs|go|java|c|cpp|h|sql|sh|ps1)$/i.test(entry.name)) { skipped.push({ name, reason: 'No searchable text importer for this file type.' }); continue; }
          try { const file = await deps.filesystem.read(entry); ingest(key, name, file.content); }
          catch (error) {
            const reason = error instanceof Error ? error.message : 'Could not read this source.';
            if (/exceeds the \d+ byte limit/.test(reason)) continue;
            skipped.push({ name, reason });
          }
        }
      };
      const nodes = deps.workspace.list();
      const descendants = new Set([id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const node of nodes) if (node.parentId && descendants.has(node.parentId) && node.kind !== 'project' && !descendants.has(node.id)) { descendants.add(node.id); changed = true; }
      }
      for (const node of nodes.filter((node) => descendants.has(node.id))) {
        if (node.kind === 'note') {
          const note = await deps.note(node.targetId);
          // Catalog targetId is the readable identity; keep ingest keys aligned with readableScopeVersions.
          if (note) ingest(`note:${node.targetId}`, note.title, exportRichDocument(note, 'markdown').content);
        } else if (node.kind === 'mount') await walk(node.rootId, '', node.name);
      }
      for (const document of deps.documents.documents(collectionId)) if (!activeDocuments.has(document.id)) {
        for (const version of deps.documents.versions(document.id)) knowledge.removeSource(version.id);
        deps.documents.deleteDocument(document.id);
      }
      snapshots.set(collectionId, sourceVersions);
      return Response.json({ imported, skipped, collectionId });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The sources could not be refreshed.' }, { status: 409 }); }
    finally { running.delete(id); }
  };
}
