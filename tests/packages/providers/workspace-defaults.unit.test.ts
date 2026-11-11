import { expect, test } from 'bun:test';
import { proposeWorkspaceDefaults, applyWorkspaceDefaults, PREFERRED_CHAT_MODELS, PREFERRED_EMBEDDING_MODELS, documentedEmbeddingDimensions } from '../../../packages/providers/src/workspace-defaults.service';
import { createWorkspaceDefaultsStore, EMPTY_WORKSPACE_DEFAULTS } from '../../../packages/providers/src/workspace-defaults.adapter';
import { modelRegistryFromManagedModels } from '../../../packages/providers/src/model-registry.policy';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const installed = modelRegistryFromManagedModels({ data: [
  { id: 'Qwen3VL-8B-Instruct-Q4_K_M', labels: ['chat'] },
  { id: 'Bonsai-1.7B-gguf', labels: ['chat'] },
  { id: 'Qwen3-Embedding-0.6B-GGUF', labels: ['embeddings'] }
] });

test('the workspace proposes the models a general workspace runs on', () => {
  const proposal = proposeWorkspaceDefaults({ registry: installed, current: EMPTY_WORKSPACE_DEFAULTS });
  expect(proposal.chat?.modelId).toBe(PREFERRED_CHAT_MODELS[0]);
  expect(proposal.embedding?.modelId).toBe(PREFERRED_EMBEDDING_MODELS[0]);
});

test('a preferred model that is not installed is never proposed', () => {
  const registry = modelRegistryFromManagedModels({ data: [{ id: 'Other-Chat-GGUF', labels: ['chat'] }] });
  const proposal = proposeWorkspaceDefaults({ registry, current: EMPTY_WORKSPACE_DEFAULTS });
  expect(proposal.chat?.modelId).toBe('Other-Chat-GGUF');
  expect(proposal.embedding).toBeNull();
});

test('the stored default survives a restart and only changes when it is written again', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-workspace-defaults-'));
  const path = join(root, 'providers.sqlite');
  const store = createWorkspaceDefaultsStore(path);
  try {
    expect(store.read()).toEqual(EMPTY_WORKSPACE_DEFAULTS);
    const proposal = proposeWorkspaceDefaults({ registry: installed, current: EMPTY_WORKSPACE_DEFAULTS });
    const saved = applyWorkspaceDefaults(store, {
      chat: proposal.chat,
      embedding: proposal.embedding,
      embeddingRevision: 'Qwen3-Embedding-0.6B-GGUF',
      embeddingDimensions: 1024
    });
    expect(saved.chatModel).toBe('Bonsai-1.7B-gguf');
    expect(saved.embeddingModel).toBe('Qwen3-Embedding-0.6B-GGUF');
    expect(saved.embeddingDimensions).toBe(1024);
    // A new store over the same file reads the same default, which is what
    // makes the choice survive a restart.
    const reopened = createWorkspaceDefaultsStore(path);
    expect(reopened.read()).toEqual(saved);
    reopened.close();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('preferred embedding models have documented vector widths for setup without a live probe', () => {
  expect(documentedEmbeddingDimensions(PREFERRED_EMBEDDING_MODELS[0]!)).toBe(1024);
  expect(documentedEmbeddingDimensions('unknown-embed')).toBeNull();
});

test('an embedding model without its width is not stored', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-workspace-defaults-'));
  const store = createWorkspaceDefaultsStore(join(root, 'providers.sqlite'));
  try {
    const saved = applyWorkspaceDefaults(store, {
      embedding: { providerId: 'managed-local', modelId: 'Qwen3-Embedding-0.6B-GGUF', roles: ['embedding'], reason: 'only-embedding-model' },
      embeddingRevision: 'Qwen3-Embedding-0.6B-GGUF',
      embeddingDimensions: null
    });
    expect(saved.embeddingModel).toBeNull();
    expect(saved.embeddingDimensions).toBeNull();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
