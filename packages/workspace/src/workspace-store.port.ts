import type { WorkspaceMove, WorkspaceNode, WorkspaceNodeInput, WorkspaceNodeUpdate, WorkspaceOrganization, WorkspaceRemoval } from './workspace-catalog.domain.public';

export interface WorkspaceStore {
  list(): WorkspaceNode[];
  get(id: string): WorkspaceNode | null;
  create(input: WorkspaceNodeInput): WorkspaceNode;
  update(id: string, update: WorkspaceNodeUpdate): WorkspaceNode | null;
  moveMany(move: WorkspaceMove): WorkspaceNode[];
  moveChats(move: { ids: string[]; parentId: string | null }): void;
  organize(move: WorkspaceOrganization): WorkspaceNode[];
  clearPersonalData(): void;
  remove(id: string, policy: 'keep-chats' | 'delete-chats'): WorkspaceRemoval | null;
  instruction(conversationId: string): string;
  close(): void;
}
