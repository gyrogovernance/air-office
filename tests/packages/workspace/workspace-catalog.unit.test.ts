import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultConversationStore, workspaceConversationPlacement } from '../../../packages/chat/src/chat.service.public';
import { createVaultWorkspaceStore } from '../../../packages/workspace/src/vault-workspace-store.adapter';
import { createVaultRichDocumentStore } from '../../../packages/editor/src/rich-document.service.public';
import { createRichDocument } from '../../../packages/editor/src/rich-document.domain.public';
import { WorkspaceError } from '../../../packages/workspace/src/workspace-catalog.domain.public';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-vault-workspace-'));
  process.env.AIR_VAULT_ROOT = root;
  const notes = createVaultRichDocumentStore(root);
  const conversations = createVaultConversationStore(root);
  const store = createVaultWorkspaceStore({ vaultRoot: root, conversations: workspaceConversationPlacement(conversations) });
  return {
    root,
    notes,
    conversations,
    store,
    close: () => {
      store.close();
      notes.close();
      conversations.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('ensures general program and files new notes under programs/general/notes', () => {
  const f = fixture();
  try {
    const general = f.store.list().find((node) => node.kind === 'program' && node.name === 'General');
    expect(general?.id).toBe('program:general');
    expect(existsSync(join(f.root, 'programs', 'general', 'notes'))).toBe(true);
    const document = f.notes.save(createRichDocument('Draft', 'doc-1'));
    expect(document.path).toBe('programs/general/notes/draft.note.json');
    const filed = f.store.list().find((node) => node.kind === 'note' && node.targetId === 'programs/general/notes/draft.note.json');
    expect(filed).toMatchObject({ kind: 'note', parentId: 'program:general', targetId: 'programs/general/notes/draft.note.json', id: 'note:programs/general/notes/draft.note.json' });
  } finally {
    f.close();
  }
});

test('programs and projects persist as directories with instruction.md', () => {
  const f = fixture();
  try {
    const program = f.store.create({ id: 'ignored', kind: 'program', name: 'Research', instruction: 'Careful evidence' });
    expect(program.id).toBe('program:research');
    expect(readFileSync(join(f.root, 'programs', 'research', 'instruction.md'), 'utf8')).toContain('Careful evidence');
    const project = f.store.create({ id: 'ignored', kind: 'project', parentId: program.id, name: 'Papers', instruction: 'Quote sources' });
    expect(project.id).toBe('project:research/papers');
    expect(project.parentId).toBe(program.id);
    expect(() => f.store.create({ id: 'bad', kind: 'project', parentId: project.id, name: 'Bad' })).toThrow(WorkspaceError);
  } finally {
    f.close();
  }
});

test('mounts are recorded in workspace.yaml by rootId', () => {
  const f = fixture();
  try {
    const program = f.store.create({ id: 'p', kind: 'program', name: 'Lab' });
    const mount = f.store.create({ id: 'm', kind: 'mount', parentId: program.id, name: 'Docs', rootId: 'root-1' });
    expect(mount.id).toBe('mount:m');
    expect(mount.rootId).toBe('root-1');
    expect(readFileSync(join(f.root, '.air', 'settings', 'workspace.yaml'), 'utf8')).toContain('root-1');
    f.store.remove(mount.id, 'keep-chats');
    expect(f.store.list().some((node) => node.kind === 'mount')).toBe(false);
  } finally {
    f.close();
  }
});

test('chat folder placement updates conversation meta.yaml folderId', () => {
  const f = fixture();
  try {
    const program = f.store.create({ id: 'p', kind: 'program', name: 'Study', instruction: 'Study rules' });
    f.conversations.ensure('chat-1');
    f.store.moveChats({ ids: ['chat-1'], parentId: program.id });
    expect(f.conversations.load('chat-1')?.conversation.folderId).toBe(program.id);
    expect(f.store.instruction('chat-1')).toBe('Study rules');
    expect(existsSync(join(f.root, 'programs', 'study', 'chats', 'chat-1', 'meta.yaml'))).toBe(true);
    expect(existsSync(join(f.root, 'programs', 'general', 'chats', 'chat-1'))).toBe(false);
  } finally {
    f.close();
  }
});

test('removing a program with keep-chats relocates note files into General before deleting the tree', () => {
  const f = fixture();
  try {
    const program = f.store.create({ id: 'p', kind: 'program', name: 'Archive Me' });
    const document = f.notes.save({ ...createRichDocument('Keep Me', 'keep-me'), programSlug: 'archive-me' });
    const filed = f.store.create({ id: 'n', kind: 'note', parentId: program.id, name: 'Keep Me', targetId: document.path ?? document.id });
    expect(filed.targetId.startsWith('programs/archive-me/')).toBe(true);
    const removal = f.store.remove(program.id, 'keep-chats');
    expect(removal?.documentIds).toContain(filed.targetId);
    expect(f.store.get(program.id)).toBeNull();
    expect(existsSync(join(f.root, 'programs', 'archive-me'))).toBe(false);
    const relocated = f.notes.list().find((note) => note.id === document.id);
    expect(relocated?.path?.startsWith('programs/general/notes/')).toBe(true);
    expect(existsSync(join(f.root, relocated!.path!))).toBe(true);
  } finally {
    f.close();
  }
});
