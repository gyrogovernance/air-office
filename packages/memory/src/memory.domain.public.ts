export interface MemoryFact {
  id: string;
  content: string;
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function validateMemoryContent(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 2000;
}

export function isMemoryFact(value: unknown): value is MemoryFact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fact = value as Record<string, unknown>;
  return typeof fact.id === 'string' && fact.id.length > 0 && fact.id.length <= 200 && validateMemoryContent(fact.content) &&
    (fact.conversationId === null || typeof fact.conversationId === 'string' && fact.conversationId.length > 0 && fact.conversationId.length <= 200) &&
    typeof fact.createdAt === 'string' && !Number.isNaN(Date.parse(fact.createdAt)) &&
    typeof fact.updatedAt === 'string' && !Number.isNaN(Date.parse(fact.updatedAt));
}

export function createMemoryFact(input: { content: string; conversationId?: string | null; now?: string; id?: string }): MemoryFact {
  if (!validateMemoryContent(input.content)) throw new Error('A memory needs between 1 and 2000 characters of text.');
  const now = input.now ?? new Date().toISOString();
  const fact: MemoryFact = { id: input.id ?? crypto.randomUUID(), content: input.content.trim(), conversationId: input.conversationId ?? null, createdAt: now, updatedAt: now };
  if (!isMemoryFact(fact)) throw new Error('A memory needs between 1 and 2000 characters of text.');
  return fact;
}
export { episodicProjection, exchangeMessagesSchema } from './episodic-memory.policy';
export type { EpisodicRecord, EpisodicRecordView, EpisodeSource, ReasoningMessage } from './episodic-memory.policy';
export type { ExchangeMessages } from './episodic-memory.policy';
