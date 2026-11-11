import { z } from 'zod';

const messageContent = z.string().min(1).regex(/\S/);
export const exchangeMessagesSchema = z.tuple([
  z.strictObject({ role: z.literal('user'), content: messageContent }),
  z.strictObject({ role: z.literal('assistant'), content: messageContent }),
  z.strictObject({ role: z.literal('user'), content: messageContent }),
]);
export type ExchangeMessages = z.infer<typeof exchangeMessagesSchema>;

const episodeSourceSchema = z.strictObject({
  message_id: z.string().min(1),
  occurred_at: z.string(),
  role: z.enum(['user', 'assistant']),
});
export type EpisodeSource = z.infer<typeof episodeSourceSchema>;

export const episodicRecordSchema = z.strictObject({
  record_id: z.string().min(1),
  conversation_id: z.string().min(1),
  branch_id: z.string().min(1),
  created_at: z.string(),
  state: z.literal('ready'),
  messages: exchangeMessagesSchema,
  sources: z.tuple([
    episodeSourceSchema.extend({ role: z.literal('user') }),
    episodeSourceSchema.extend({ role: z.literal('assistant') }),
    episodeSourceSchema.extend({ role: z.literal('user') }),
  ]),
  indexed: z.boolean(),
  error: z.string().nullable(),
});
export type EpisodicRecord = z.infer<typeof episodicRecordSchema>;
export type EpisodicRecordView = Omit<EpisodicRecord, 'messages'> & { messages: { role: 'user' | 'assistant'; content: string; truncated: boolean }[] };

export const storedExchangeSchema = z.discriminatedUnion('state', [
  episodicRecordSchema,
  z.strictObject({ state: z.literal('deleted'), record_id: z.string().min(1), conversation_id: z.string().min(1) }),
]);
export type StoredExchange = z.infer<typeof storedExchangeSchema>;

export interface ExchangeReference {
  record_id: string;
  conversation_id: string;
  branch_id: string;
  created_at: string;
  indexed: boolean;
  previous_record_id: string | null;
  snapshot_ids: string[];
  message_ids: string[];
}

export interface ReasoningMessage {
  id: string;
  parentId: string | null;
  role: 'system' | 'user' | 'assistant';
  content: string;
  complete: boolean;
  createdAt: string;
  failed: boolean;
}

export function episodicProjection(record: EpisodicRecord): string {
  return record.messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
}
