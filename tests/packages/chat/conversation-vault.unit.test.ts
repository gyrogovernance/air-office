import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  conversationVaultPathHint,
  createVaultConversationStore,
  programSlugForFolderId,
  workspaceConversationPlacement,
} from '../../../packages/chat/src/conversation-vault.adapter';

function withStore() {
  const root = mkdtempSync(join(tmpdir(), 'air-conversation-vault-'));
  process.env.AIR_VAULT_ROOT = root;
  const store = createVaultConversationStore(root);
  return {
    root,
    store,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('vault conversation placement', () => {
  test('programSlugForFolderId maps program, project, folder, note and unfiled ids', () => {
    expect(programSlugForFolderId(null)).toBe('general');
    expect(programSlugForFolderId('program:Study Notes')).toBe('study-notes');
    expect(programSlugForFolderId('project:research/alpha')).toBe('research');
    expect(programSlugForFolderId('folder:lab/notes/inbox')).toBe('lab');
    expect(programSlugForFolderId('folder:lab/projects/alpha/notes/drafts')).toBe('lab');
    expect(programSlugForFolderId('note:programs/research/notes/brief.note.json')).toBe('research');
    expect(programSlugForFolderId('note:programs/lab/projects/alpha/notes/draft.note.json')).toBe('lab');
    expect(programSlugForFolderId('opaque-legacy')).toBe('general');
  });

  test('setFolder relocates the chat directory into the owning program chats folder', () => {
    const f = withStore();
    try {
      f.store.ensure('chat-move');
      f.store.appendMessage({ conversationId: 'chat-move', id: 'm1', parentId: null, role: 'user', content: 'hello', complete: true });
      expect(existsSync(join(f.root, 'programs', 'general', 'chats', 'chat-move', 'meta.yaml'))).toBe(true);

      const placement = workspaceConversationPlacement(f.store);
      mkdirSync(join(f.root, 'programs', 'study', 'chats'), { recursive: true });
      writeFileSync(join(f.root, 'programs', 'study', 'instruction.md'), '# Study\n', 'utf8');
      placement.setFolder('chat-move', 'program:study');

      expect(existsSync(join(f.root, 'programs', 'general', 'chats', 'chat-move'))).toBe(false);
      expect(existsSync(join(f.root, 'programs', 'study', 'chats', 'chat-move', 'meta.yaml'))).toBe(true);
      expect(existsSync(join(f.root, 'programs', 'study', 'chats', 'chat-move', 'messages.jsonl'))).toBe(true);
      expect(f.store.load('chat-move')?.conversation.folderId).toBe('program:study');
      expect(conversationVaultPathHint(f.root, 'chat-move')).toBe('programs/study/chats/chat-move');
      expect(f.store.summaries(10).map((row) => row.id)).toEqual(['chat-move']);

      placement.setFolder('chat-move', 'note:programs/study/notes/brief.note.json');
      expect(existsSync(join(f.root, 'programs', 'study', 'chats', 'chat-move', 'meta.yaml'))).toBe(true);
      expect(f.store.load('chat-move')?.conversation.folderId).toBe('note:programs/study/notes/brief.note.json');
      expect(conversationVaultPathHint(f.root, 'chat-move')).toBe('programs/study/chats/chat-move');

      placement.setFolder('chat-move', null);
      expect(existsSync(join(f.root, 'programs', 'study', 'chats', 'chat-move'))).toBe(false);
      expect(existsSync(join(f.root, 'programs', 'general', 'chats', 'chat-move', 'meta.yaml'))).toBe(true);
      expect(f.store.load('chat-move')?.conversation.folderId).toBeNull();
    } finally {
      f.close();
    }
  });

  test('findLocation loads chats already stored under a non-general program', () => {
    const f = withStore();
    try {
      const dir = join(f.root, 'programs', 'lab', 'chats', 'preplaced');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'meta.yaml'), [
        'title: Preplaced',
        'pinned: false',
        'archivedAt: null',
        'tags: []',
        'folderId: program:lab',
        'unreadAt: null',
        'createdAt: 2026-01-01T00:00:00.000Z',
        'updatedAt: 2026-01-01T00:00:00.000Z',
        '',
      ].join('\n'), 'utf8');
      writeFileSync(join(dir, 'messages.jsonl'), '', 'utf8');

      const reopened = createVaultConversationStore(f.root);
      try {
        expect(reopened.load('preplaced')?.conversation.title).toBe('Preplaced');
        expect(reopened.summaries(10).map((row) => row.id)).toEqual(['preplaced']);
        expect(conversationVaultPathHint(f.root, 'preplaced')).toBe('programs/lab/chats/preplaced');
      } finally {
        reopened.close();
      }
    } finally {
      f.close();
    }
  });
});
