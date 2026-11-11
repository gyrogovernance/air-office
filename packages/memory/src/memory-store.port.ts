import type { MemoryFact } from './memory.domain.public';

export interface MemoryStore {
  /** Facts ordered newest first; an optional query matches content case-insensitively. */
  list(query?: string, limit?: number): MemoryFact[];
  get(id: string): MemoryFact | null;
  save(fact: MemoryFact): void;
  remove(id: string): boolean;
  /** Deletes every stored fact and returns how many were removed. */
  clear(): number;
  /** Personalization switch for storage and retrieval. Stored facts survive disabling it. */
  enabled(): boolean;
  setEnabled(value: boolean): void;
  close(): void;
}
