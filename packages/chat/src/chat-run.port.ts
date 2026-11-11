import type { ChatEventEnvelope, ChatRunRequest } from '@office/contracts/chat';
import type { ChatRunState } from './chat.domain.public';

export type StoredRunStatus = 'running' | 'complete' | 'cancelled' | 'failed' | 'interrupted';
export interface StoredChatRun {
  request: ChatRunRequest;
  executionIdentity?: string;
  status: StoredRunStatus;
  state: ChatRunState;
}
export interface ChatRunStore {
  create(request: ChatRunRequest, executionIdentity?: string): boolean;
  get(runId: string): StoredChatRun | null;
  events(runId: string, after: number, limit?: number): ChatEventEnvelope[];
  append(event: ChatEventEnvelope): void;
  interrupt(): void;
  close(): void;
}
