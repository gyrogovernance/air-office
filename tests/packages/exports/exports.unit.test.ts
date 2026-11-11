import { describe, expect, test } from 'bun:test';
import type { WorkspaceBundle, ExportedDocument } from '@office/contracts/export';
import { MAX_BUNDLE_BYTES } from '@office/contracts/export';
import { buildWorkspaceBundle, type ExportSources } from '../../../packages/exports/src/file/file.exports.public';
import { validateBundle, restoreRows } from '../../../packages/exports/src/file/bundle.policy';
import { exportConversationDataset } from '../../../packages/exports/src/exports.domain.public';

test('conversation JSONL retains the human continuation and excludes private envelope fields', () => {
  const privateRecord = { conversationId: 'private-chat', provider: 'private-provider', messages: [
    { role: 'user', content: 'Compare costs.\nInclude the whole period.' },
    { role: 'assistant', content: 'The first is cheaper.' },
    { role: 'user', content: 'Include maintenance too.' },
  ] };
  const result = exportConversationDataset([privateRecord]);
  expect(result.trim().split('\n')).toHaveLength(1);
  expect(JSON.parse(result)).toEqual({ messages: [
    { role: 'user', content: 'Compare costs.\nInclude the whole period.' },
    { role: 'assistant', content: 'The first is cheaper.' },
    { role: 'user', content: 'Include maintenance too.' },
  ] });
});

const artifact = {
  extractor: 'python-worker',
  extractorVersion: '1.0.0',
  extractionVersion: 'extraction-1',
  text: 'Portable retrieval text with an anchor target.',
  pageCount: null,
  warnings: [],
  contentHash: 'b'.repeat(64),
  createdAt: '2026-10-11T10:00:00.000Z'
};

function fakeSources(overrides: { rawConversation?: string } = {}): ExportSources {
  return {
    listConversations: async () => [{ id: 'conv-1', createdAt: '2026-10-11T09:00:00.000Z' }],
    readConversation: async () => overrides.rawConversation ?? JSON.stringify({
      title: 'Probe chat',
      createdAt: '2026-10-11T09:00:00.000Z',
      updatedAt: '2026-10-11T09:30:00.000Z',
      messages: [
        { id: 'm1', parentId: null, role: 'user', content: 'Question', complete: true, createdAt: '2026-10-11T09:00:01.000Z', apiKey: 'sk-should-not-travel' },
        { id: 'm2', parentId: 'm1', role: 'assistant', content: 'Answer', complete: true, createdAt: '2026-10-11T09:00:02.000Z' }
      ]
    }),
    listCollections: async () => [{ id: 'col-1', name: 'Reference', createdAt: '2026-10-11T08:00:00.000Z' }],
    listDocuments: async () => [{
      id: 'doc-1',
      name: 'notes.txt',
      kind: 'text' as const,
      collectionId: 'col-1',
      createdAt: '2026-10-11T08:30:00.000Z',
      versions: [{ id: 'doc-1:abcdef', contentHash: 'a'.repeat(64), byteSize: 44, observedAt: '2026-10-11T08:31:00.000Z' }]
    }],
    artifact: () => artifact
  };
}

/** Rebuilds sources from restored rows so a second export can be compared byte for byte. */
function sourcesFrom(bundle: WorkspaceBundle, restored: ReturnType<typeof restoreRows>): ExportSources {
  const conversations = restored.conversations.map((conversation) => ({ id: conversation.id, createdAt: conversation.createdAt }));
  return {
    listConversations: async () => conversations,
    readConversation: async (id) => {
      const conversation = restored.conversations.find((entry) => entry.id === id)!;
      return JSON.stringify({ title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messages: conversation.messages });
    },
    listCollections: async () => restored.collections,
    listDocuments: async () => restored.documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      kind: doc.kind,
      collectionId: doc.collectionId,
      createdAt: doc.createdAt,
      versions: doc.versions.map((version) => ({ id: `${doc.id}:${version.contentHash.slice(0, 16)}`, contentHash: version.contentHash, byteSize: version.byteSize, observedAt: version.observedAt }))
    })),
    artifact: (documentId, versionId) => {
      const document = restored.documents.find((entry) => entry.id === documentId)!;
      const version = document.versions.find((entry) => `${document.id}:${entry.contentHash.slice(0, 16)}` === versionId);
      return version?.artifact ?? null;
    }
  } as ExportSources;
}

describe('workspace bundle export and import', () => {
  test('valid bundle roundtrips with full fidelity', async () => {
    const first = await buildWorkspaceBundle(fakeSources());
    const validation = await validateBundle(JSON.stringify(first));
    expect(validation.report.accepted).toBe(true);

    const restored = restoreRows(validation.bundle!);
    expect(restored.conversations).toHaveLength(1);
    expect(restored.conversations[0].messages).toHaveLength(2);
    expect(restored.collections[0].name).toBe('Reference');
    expect(restored.documents[0].versions[0].contentHash).toBe('a'.repeat(64));
    expect(restored.documents[0].versions[0].artifact?.text).toBe(artifact.text);

    const second = await buildWorkspaceBundle(sourcesFrom(first, restored));
    expect(second.payload).toEqual(first.payload);
    const revalidation = await validateBundle(JSON.stringify(second));
    expect(revalidation.report.accepted).toBe(true);
  });

  test('path traversal in a document path is rejected', async () => {
    const bundle = await buildWorkspaceBundle(fakeSources());
    (bundle.payload.documents[0] as ExportedDocument).path = '../../secrets/keys';
    const result = await validateBundle(JSON.stringify(bundle));
    expect(result.report.accepted).toBe(false);
    expect(result.report.rejections[0].code).toBe('path-traversal');
    expect(result.bundle).toBeNull();
  });

  test('absolute and drive-letter paths are rejected', async () => {
    for (const path of ['/etc/passwd', 'C:\\Windows\\system32', '\\\\share\\file']) {
      const bundle = await buildWorkspaceBundle(fakeSources());
      (bundle.payload.documents[0] as ExportedDocument).path = path;
      const result = await validateBundle(JSON.stringify(bundle));
      expect(result.report.accepted).toBe(false);
      expect(result.report.rejections[0].code).toBe('path-traversal');
    }
  });

  test('oversized bundles are rejected before parsing', async () => {
    const raw = 'x'.repeat(MAX_BUNDLE_BYTES + 1);
    const result = await validateBundle(raw);
    expect(result.report.rejections[0].code).toBe('oversized');
  });

  test('a different bundle kind is rejected', async () => {
    const bundle = await buildWorkspaceBundle(fakeSources());
    const foreign = { ...bundle, manifest: { ...bundle.manifest, kind: 'different-bundle' } };
    const result = await validateBundle(JSON.stringify(foreign));
    expect(result.report.rejections[0].code).toBe('not-a-bundle');
  });

  test('a modified payload fails its manifest fingerprint', async () => {
    const bundle = await buildWorkspaceBundle(fakeSources());
    bundle.payload.documents[0].name = 'tampered.txt';
    const result = await validateBundle(JSON.stringify(bundle));
    expect(result.report.rejections[0].code).toBe('fingerprint-mismatch');
  });

  test('non-bundle input is rejected', async () => {
    expect((await validateBundle('not json')).report.rejections[0].code).toBe('not-a-bundle');
    expect((await validateBundle('{"manifest":{},"payload":{}}')).report.rejections[0].code).toBe('not-a-bundle');
  });

  test('provider material in source rows never reaches the bundle', async () => {
    const rawConversation = JSON.stringify({
      title: 'Probe chat',
      createdAt: '2026-10-11T09:00:00.000Z',
      updatedAt: '2026-10-11T09:30:00.000Z',
      providerKey: 'sk-export-leak',
      messages: [{ id: 'm1', parentId: null, role: 'user', content: 'Question', complete: true, createdAt: '2026-10-11T09:00:01.000Z' }]
    });
    const bundle = await buildWorkspaceBundle(fakeSources({ rawConversation }));
    expect(JSON.stringify(bundle)).not.toContain('sk-export-leak');
    expect(JSON.stringify(bundle)).not.toContain('sk-should-not-travel');
  });
});
