import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultWorkspaceStore } from '@office/workspace/service';
import { createVaultRichDocumentStore } from '@office/editor/rich-document-service';
import { createFilesystemExplorer } from '@office/files/service';
import { createDocumentsService, createSqliteDocumentStore } from '@office/documents/service';
import { createKnowledgeService, createSqliteKnowledgeStore, createDeterministicEmbeddingProvider } from '@office/knowledge/service';
import { createRichDocument, markdownToNativeBody } from '@office/editor/rich-document-domain';
import { createWorkspaceKnowledgeRoutes, inheritedScopeCollections, readableScopeVersions, scopeCollectionId } from '../../../apps/service/src/workspace-knowledge.route';

test('scope refresh indexes linked files and notes without sibling leakage and removes disconnected material', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-scope-test-'));
  const vaultRoot = mkdtempSync(join(tmpdir(), 'air-scope-vault-'));
  process.env.AIR_VAULT_ROOT = vaultRoot;
  const workspace = createVaultWorkspaceStore({ vaultRoot });
  const noteStore = createVaultRichDocumentStore(vaultRoot);
  const filesystem = createFilesystemExplorer({ databasePath: ':memory:' });
  const documentStore = createSqliteDocumentStore(join(scratch, 'documents.sqlite'));
  const knowledgeStore = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  const documents = createDocumentsService(documentStore);
  const knowledge = createKnowledgeService(knowledgeStore, createDeterministicEmbeddingProvider());
  const pending: Promise<unknown>[] = [];
  const originalNote = { ...createRichDocument('Roadmap', 'note'), body: markdownToNativeBody('Saffron roadmap belongs to project one.') };
  let note = originalNote;
  try {
    writeFileSync(join(scratch, 'reference.txt'), 'Saffron source contains the delivery evidence.');
    note = noteStore.save(originalNote);
    const sibling = noteStore.save({ ...createRichDocument('Private sibling', 'sibling'), body: markdownToNativeBody('Sibling only.') });
    const program = workspace.create({ id: 'p', kind: 'program', name: 'Program', instruction: 'Program rules' });
    const one = workspace.create({ id: 'one', kind: 'project', parentId: program.id, name: 'One', instruction: 'Project rules' });
    const two = workspace.create({ id: 'two', kind: 'project', parentId: program.id, name: 'Two' });
    workspace.create({ id: 'n', kind: 'note', targetId: note.path ?? note.id, parentId: one.id, name: 'Roadmap' });
    workspace.create({ id: 'sibling', kind: 'note', targetId: sibling.path ?? sibling.id, parentId: two.id, name: 'Private sibling' });
    const root = await filesystem.connect({ path: scratch });
    const mount = workspace.create({ id: 'mount', kind: 'mount', parentId: one.id, rootId: root.id, name: 'Sources' });
    const handle = createWorkspaceKnowledgeRoutes({
      workspace,
      filesystem,
      documents,
      knowledge: () => knowledge,
      note: (id) => {
        const stored = noteStore.get(id);
        if (!stored) return null;
        if (stored.id === note.id || stored.path === note.path) return { ...note, path: stored.path };
        return null;
      },
      index: ({ collectionId, versionId }) => { const artifact = documents.artifact(versionId); if (artifact) pending.push(knowledge.indexSource({ collectionId, sourceVersionId: versionId, artifact })); },
    });
    const refresh = () => handle(new Request(`http://office/api/v1/workspace/scopes/${encodeURIComponent(one.id)}/knowledge`, { method: 'POST' }));
    expect((await refresh())?.status).toBe(200);
    await Promise.all(pending);
    const collectionId = scopeCollectionId(one.id);
    expect(documents.documents(collectionId).map((item) => item.name).sort()).toEqual(['Roadmap', 'Sources/reference.txt']);
    expect(inheritedScopeCollections(workspace, one.id)).toEqual([scopeCollectionId(program.id), collectionId]);
    expect(inheritedScopeCollections(workspace, two.id)).not.toContain(collectionId);
    const results = await knowledge.retrieve({ collectionIds: [collectionId], query: { mode: 'full-text', text: 'Saffron', limit: 5 }, policy: { canRead: () => true } });
    expect(results.length).toBe(2);
    await refresh(); await Promise.all(pending);
    expect(documents.documents(collectionId)).toHaveLength(2);
    workspace.remove(mount.id, 'keep-chats');
    expect(readableScopeVersions(workspace, filesystem, documents, one.id)).toHaveLength(1);
    await handle(new Request(`http://office/api/v1/workspace/scopes/${encodeURIComponent(program.id)}/knowledge`, { method: 'POST' }));
    const material = () => handle(new Request(`http://office/api/v1/workspace/scopes/${encodeURIComponent(one.id)}/material`));
    expect(await (await material())?.json()).toMatchObject({ instruction: 'Program rules\n\nProject rules', sources: [{ name: 'Roadmap', text: expect.stringContaining('project one') }] });
    note = { ...createRichDocument('Roadmap', 'note'), body: markdownToNativeBody('Revised roadmap text.') };
    await refresh();
    expect(await (await material())?.json()).toMatchObject({ sources: [{ text: expect.stringContaining('Revised roadmap') }] });
    note = originalNote;
    await refresh();
    expect(await (await material())?.json()).toMatchObject({ sources: [{ text: expect.stringContaining('project one') }] });
    await refresh(); await Promise.all(pending);
    expect(documents.documents(collectionId).map((item) => item.name)).toEqual(['Roadmap']);
    expect(await handle(new Request('http://office/api/v1/workspace/scopes/missing/knowledge', { method: 'POST' }))).toHaveProperty('status', 404);
  } finally {
    workspace.close();
    noteStore.close();
    filesystem.close();
    documentStore.close();
    knowledgeStore.close();
    rmSync(scratch, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});
