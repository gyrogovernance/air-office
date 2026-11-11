import { createMemoryFact, validateMemoryContent } from './memory.domain.public';
import type { MemoryFact } from './memory.domain.public';
import type { MemoryStore } from './memory-store.port';

export type { MemoryFact } from './memory.domain.public';
export type { MemoryStore } from './memory-store.port';
export { createMemoryFact, isMemoryFact, validateMemoryContent } from './memory.domain.public';
export { createVaultMemoryStore } from './memory-store.vault.adapter';

export interface MemoryRecall {
  enabled: boolean;
  memories: MemoryFact[];
}

export type MemoryService = ReturnType<typeof createMemoryService>;

/**
 * Conversation memory with an explicit switch. Disabling stops storage and
 * retrieval while stored facts stay intact, and deleting one fact or clearing
 * them all works whether the switch is on or off, so the product keeps those
 * actions separate.
 */
export function createMemoryService(store: MemoryStore) {
  return {
    enabled: (): boolean => store.enabled(),
    setEnabled: (value: boolean): void => { store.setEnabled(value); },
    /** Management listing shows what is stored whether or not retrieval is enabled. */
    memories: (query?: string, limit?: number): MemoryFact[] => store.list(query, limit),
    remember: (input: { content: string; conversationId?: string | null }): MemoryFact => {
      if (!store.enabled()) throw new Error('Memory is turned off. Enable it in settings before storing facts.');
      const fact = createMemoryFact(input);
      store.save(fact);
      return fact;
    },
    recall: (query?: string, limit?: number): MemoryRecall => ({ enabled: store.enabled(), memories: store.enabled() ? store.list(query, limit) : [] }),
    update: (id: string, content: string): MemoryFact | null => {
      const current = store.get(id);
      if (!current) return null;
      if (!validateMemoryContent(content)) throw new Error('A memory needs between 1 and 2000 characters of text.');
      const updated: MemoryFact = { ...current, content: content.trim(), updatedAt: new Date().toISOString() };
      store.save(updated);
      return updated;
    },
    forget: (id: string): boolean => store.remove(id),
    clear: (): number => store.clear()
  };
}
export { createVaultEpisodicStore } from './episodic-vault.adapter';
export { createReasoningService } from './reasoning.service';
export type { ReasoningPorts, MemoryRanking } from './reasoning.service';
