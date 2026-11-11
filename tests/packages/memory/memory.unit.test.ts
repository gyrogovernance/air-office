import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFact, createMemoryService, createVaultMemoryStore, validateMemoryContent } from '../../../packages/memory/src/memory.service.public';
import type { MemoryStore } from '../../../packages/memory/src/memory-store.port';

async function withStore(run: (service: ReturnType<typeof createMemoryService>) => void | Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'air-memory-'));
  process.env.AIR_VAULT_ROOT = directory;
  const store: MemoryStore = createVaultMemoryStore(directory);
  const service = createMemoryService(store);
  try {
    await run(service);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('facts are stored once, recalled newest first, and filtered by query', () => withStore((service) => {
  const concise = service.remember({ content: 'Prefers concise summaries', conversationId: 'conversation-1' });
  const workspace = service.remember({ content: 'Builds the AIR Office workspace' });
  expect(concise.conversationId).toBe('conversation-1');
  expect(workspace.conversationId).toBeNull();
  expect(service.memories()).toHaveLength(2);
  const recall = service.recall();
  expect(recall.enabled).toBe(true);
  expect(recall.memories).toHaveLength(2);
  expect(recall.memories.map((fact) => fact.id).sort()).toEqual([concise.id, workspace.id].sort());
  expect(service.recall('concise').memories.map((fact) => fact.id)).toEqual([concise.id]);
  expect(service.recall('no such fact').memories).toEqual([]);
  expect(service.memories('AIR Office').map((fact) => fact.id)).toEqual([workspace.id]);
}));

test('the switch stops storage and retrieval while stored facts stay intact', () => withStore((service) => {
  service.remember({ content: 'Ships on Fridays' });
  service.setEnabled(false);
  expect(service.enabled()).toBe(false);
  expect(() => service.remember({ content: 'New fact' })).toThrow('Memory is turned off');
  expect(service.recall('Fridays')).toEqual({ enabled: false, memories: [] });
  expect(service.memories()).toHaveLength(1);
  service.setEnabled(true);
  expect(service.recall('Fridays').memories).toHaveLength(1);
}));

test('update, forget, and clear are separate management actions', () => withStore((service) => {
  const fact = service.remember({ content: 'original' });
  const updated = service.update(fact.id, '  revised  ');
  expect(updated?.content).toBe('revised');
  expect(updated !== null && updated.updatedAt >= fact.updatedAt).toBe(true);
  expect(service.update('missing-fact', 'text')).toBeNull();
  expect(() => service.update(fact.id, '   ')).toThrow('between 1 and 2000');
  expect(service.forget(fact.id)).toBe(true);
  expect(service.forget(fact.id)).toBe(false);
  service.remember({ content: 'first spare' });
  service.remember({ content: 'second spare' });
  expect(service.clear()).toBe(2);
  expect(service.memories()).toEqual([]);
}));

test('a query treats SQL wildcards as literal text', () => withStore((service) => {
  service.remember({ content: 'Shipment is 100% complete' });
  service.remember({ content: 'Shipment is delayed' });
  expect(service.recall('100%').memories.map((fact) => fact.content)).toEqual(['Shipment is 100% complete']);
  expect(service.recall('%').memories.map((fact) => fact.content)).toEqual(['Shipment is 100% complete']);
  expect(service.recall('_').memories).toEqual([]);
}));

test('fact content is validated at creation and on write', () => {
  expect(validateMemoryContent('ok')).toBe(true);
  expect(validateMemoryContent('  padded  ')).toBe(true);
  expect(validateMemoryContent('')).toBe(false);
  expect(validateMemoryContent('   ')).toBe(false);
  expect(validateMemoryContent('x'.repeat(2001))).toBe(false);
  expect(validateMemoryContent(42)).toBe(false);
  expect(() => createMemoryFact({ content: '  ' })).toThrow('between 1 and 2000');
  expect(createMemoryFact({ content: ' trimmed ', id: 'fact-1', now: '2026-10-14T00:00:00.000Z', conversationId: null })).toEqual({
    id: 'fact-1', content: 'trimmed', conversationId: null, createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z'
  });
});

test('stored facts and the switch survive reopening the vault', () => {
  const directory = mkdtempSync(join(tmpdir(), 'air-memory-'));
  process.env.AIR_VAULT_ROOT = directory;
  try {
    const first = createVaultMemoryStore(directory);
    first.setEnabled(false);
    first.save(createMemoryFact({ content: 'Persistent fact' }));
    first.close();
    const reopened = createVaultMemoryStore(directory);
    expect(reopened.enabled()).toBe(false);
    expect(reopened.list().map((fact) => fact.content)).toEqual(['Persistent fact']);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
