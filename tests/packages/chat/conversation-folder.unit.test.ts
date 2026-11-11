import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultConversationStore, workspaceConversationPlacement } from '../../../packages/chat/src/chat.service.public';
import { conversationVaultPathHint } from '../../../packages/chat/src/conversation-vault.adapter';
import { createVaultWorkspaceStore } from '../../../packages/workspace/src/vault-workspace-store.adapter';
import { WorkspaceError } from '../../../packages/workspace/src/workspace-catalog.domain.public';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-folders-'));
  process.env.AIR_VAULT_ROOT = root;
  const conversations = createVaultConversationStore(root);
  const workspace = createVaultWorkspaceStore({ vaultRoot: root, conversations: workspaceConversationPlacement(conversations) });
  return {
    root,
    conversations,
    workspace,
    close: () => {
      workspace.close();
      conversations.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('service-owned conversation folders', () => {
  test('persists nested stable identities, instructions, memberships, and rejects cycles', () => {
    const f = fixture();
    try {
      const parent = f.workspace.create({ id: 'ignored', kind: 'program', name: 'Research', instruction: 'Use careful evidence.' });
      const child = f.workspace.create({ id: 'ignored', kind: 'folder', name: 'Notes', parentId: parent.id, instruction: '' });
      expect(() => f.workspace.create({ id: 'ignored', kind: 'program', name: 'research' })).toThrow(WorkspaceError);
      expect(() => f.workspace.create({ id: 'ignored', kind: 'folder', name: 'Too long', parentId: parent.id, instruction: 'x'.repeat(20001) })).toThrow(WorkspaceError);
      f.conversations.ensure('chat-a');
      f.workspace.moveChats({ ids: ['chat-a'], parentId: child.id });
      expect(f.workspace.list().filter((node) => node.kind === 'program' || node.kind === 'folder').map(({ id, parentId }) => ({ id, parentId })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
        { id: child.id, parentId: parent.id },
        { id: 'program:general', parentId: null },
        { id: parent.id, parentId: null },
      ]);
      expect(f.conversations.summaries(10, 0, { folderId: child.id }).map(({ id }) => id)).toEqual(['chat-a']);
      expect(conversationVaultPathHint(f.root, 'chat-a')).toBe('programs/research/chats/chat-a');
      expect(existsSync(join(f.root, 'programs', 'general', 'chats', 'chat-a'))).toBe(false);
      expect(() => f.workspace.moveMany({ ids: [parent.id], parentId: child.id })).toThrow(WorkspaceError);
      expect(f.workspace.get(parent.id)?.parentId).toBeNull();
      f.workspace.close();
      f.conversations.close();
      const reopenedConversations = createVaultConversationStore(f.root);
      const reopened = createVaultWorkspaceStore({ vaultRoot: f.root, conversations: workspaceConversationPlacement(reopenedConversations) });
      expect(reopened.get(parent.id)?.instruction).toBe('Use careful evidence.');
      expect(reopened.get(child.id)?.parentId).toBe(parent.id);
      reopened.close();
      reopenedConversations.close();
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  test('keeps chats by moving them to the root or deletes subtree chats explicitly', () => {
    const f = fixture();
    try {
      const parent = f.workspace.create({ id: 'ignored', kind: 'program', name: 'Parent' });
      const child = f.workspace.create({ id: 'ignored', kind: 'folder', name: 'Child', parentId: parent.id });
      f.conversations.ensure('keep-chat');
      f.workspace.moveChats({ ids: ['keep-chat'], parentId: child.id });
      expect(conversationVaultPathHint(f.root, 'keep-chat')).toBe('programs/parent/chats/keep-chat');
      expect(f.workspace.remove(parent.id, 'keep-chats')).not.toBeNull();
      expect(f.conversations.load('keep-chat')?.conversation.folderId).toBeNull();
      expect(conversationVaultPathHint(f.root, 'keep-chat')).toBe('programs/general/chats/keep-chat');
      expect(existsSync(join(f.root, 'programs', 'parent'))).toBe(false);
      const remove = f.workspace.create({ id: 'ignored', kind: 'program', name: 'Remove' });
      f.conversations.ensure('delete-chat');
      f.workspace.moveChats({ ids: ['delete-chat'], parentId: remove.id });
      expect(f.workspace.remove(remove.id, 'delete-chats')).not.toBeNull();
      expect(f.conversations.load('delete-chat')).toBeNull();
    } finally { f.close(); }
  });
});
