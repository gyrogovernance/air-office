import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultAutomationStore } from '../../../packages/automations/src/automation-store.vault.adapter';
import { createVaultCalendarStore } from '../../../packages/calendar/src/calendar-store.vault.adapter';
import { createVaultConversationStore } from '../../../packages/chat/src/conversation-vault.adapter';
import { createRichDocument, markdownToNativeBody } from '../../../packages/editor/src/rich-document.domain.public';
import { createVaultRichDocumentStore } from '../../../packages/editor/src/vault-rich-document.service.public';
import { createVaultMemoryStore } from '../../../packages/memory/src/memory-store.vault.adapter';
import { createVaultMethodsStore } from '../../../packages/methods/src/methods-vault.adapter';
import { readVaultVersion } from '../../../packages/vault/src/vault.service.public';
import { runVaultMigrate } from '../../../tools/office-cli/src/vault-migrate.command';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }); }
    catch { /* Windows may keep a handle briefly after store.close */ }
  }
});

function fixtureRoot(): { privateRoot: string; vaultRoot: string } {
  const privateRoot = mkdtempSync(join(tmpdir(), 'air-migrate-private-'));
  const vaultRoot = join(privateRoot, 'vault');
  roots.push(privateRoot);
  return { privateRoot, vaultRoot };
}

function seedLegacyStores(privateRoot: string): {
  noteId: string;
  conversationId: string;
  contentHash: string;
} {
  const now = '2030-01-15T12:00:00.000Z';
  const note = {
    ...createRichDocument('Migration note', 'migrate-note-1'),
    body: markdownToNativeBody('# Migration note\n\nPreserved body.'),
    updatedAt: now,
  };

  const notesDb = new Database(join(privateRoot, 'rich-documents.sqlite'));
  notesDb.exec('CREATE TABLE rich_documents (document_json TEXT NOT NULL)');
  notesDb.query('INSERT INTO rich_documents (document_json) VALUES (?)').run(JSON.stringify(note));
  notesDb.close();

  const calendarDb = new Database(join(privateRoot, 'calendar.sqlite'));
  calendarDb.exec('CREATE TABLE calendar_lists (value_json TEXT NOT NULL); CREATE TABLE calendar_events (value_json TEXT NOT NULL)');
  calendarDb.query('INSERT INTO calendar_lists (value_json) VALUES (?)').run(JSON.stringify({
    id: 'cal-work',
    name: 'Work',
    color: '#3478db',
    visible: true,
    createdAt: now,
    updatedAt: now,
  }));
  calendarDb.query('INSERT INTO calendar_events (value_json) VALUES (?)').run(JSON.stringify({
    id: 'evt-1',
    calendarId: 'cal-work',
    title: 'Planning',
    date: '2030-01-20',
    allDay: true,
    timezone: 'UTC',
    createdAt: now,
    updatedAt: now,
  }));
  calendarDb.close();

  const automationsDb = new Database(join(privateRoot, 'automations.sqlite'));
  automationsDb.exec('CREATE TABLE automation_definitions (payload TEXT NOT NULL)');
  automationsDb.query('INSERT INTO automation_definitions (payload) VALUES (?)').run(JSON.stringify({
    id: 'auto-daily',
    name: 'Daily brief',
    enabled: true,
    missedRunPolicy: 'skip',
    recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: '2030-01-01' },
    steps: [{ kind: 'prompt', prompt: 'Summarize the day.', providerId: 'local-replay', modelId: 'local-replay' }],
    createdAt: now,
    updatedAt: now,
  }));
  automationsDb.close();

  const memoryDb = new Database(join(privateRoot, 'memory.sqlite'));
  memoryDb.exec('CREATE TABLE memory_facts (id TEXT, content TEXT, conversation_id TEXT, created_at TEXT, updated_at TEXT)');
  memoryDb.query('INSERT INTO memory_facts (id, content, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    'fact-1',
    'Prefers concise answers',
    null,
    now,
    now,
  );
  memoryDb.close();

  const conversationId = 'branch-chat';
  const chatDb = new Database(join(privateRoot, 'chat.sqlite'));
  chatDb.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      pinned INTEGER,
      archived_at TEXT,
      folder_id TEXT,
      unread_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      parent_id TEXT,
      role TEXT,
      content TEXT,
      complete INTEGER,
      run_id TEXT,
      created_at TEXT
    );
  `);
  chatDb.query('INSERT INTO conversations (id, title, pinned, archived_at, folder_id, unread_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    conversationId,
    'Branched chat',
    0,
    null,
    null,
    null,
    now,
    now,
  );
  chatDb.query('INSERT INTO conversation_messages (id, conversation_id, parent_id, role, content, complete, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'm1', conversationId, null, 'user', 'Root question', 1, null, now,
  );
  chatDb.query('INSERT INTO conversation_messages (id, conversation_id, parent_id, role, content, complete, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'm2', conversationId, 'm1', 'assistant', 'Root answer', 1, 'run-1', now,
  );
  chatDb.query('INSERT INTO conversation_messages (id, conversation_id, parent_id, role, content, complete, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'm3', conversationId, 'm1', 'assistant', 'Branch answer', 1, 'run-2', now,
  );
  chatDb.close();

  const methodsDb = new Database(join(privateRoot, 'methods.sqlite'));
  methodsDb.exec('CREATE TABLE saved_prompts (id TEXT, name TEXT, instructions TEXT, variables TEXT)');
  methodsDb.query('INSERT INTO saved_prompts (id, name, instructions, variables) VALUES (?, ?, ?, ?)').run(
    'prompt-brief',
    'Brief prompt',
    'Summarize {{topic}}.',
    JSON.stringify(['topic']),
  );
  methodsDb.close();

  const sourceText = 'Portable source body for migrate.';
  const contentHash = createHash('sha256').update(sourceText).digest('hex');
  const documentsDb = new Database(join(privateRoot, 'documents.sqlite'));
  documentsDb.exec(`
    CREATE TABLE document_documents (
      document_id TEXT PRIMARY KEY,
      collection_id TEXT,
      name TEXT,
      kind TEXT
    );
    CREATE TABLE document_versions (
      version_id TEXT PRIMARY KEY,
      document_id TEXT,
      content_hash TEXT,
      observed_at TEXT
    );
    CREATE TABLE document_bytes (
      version_id TEXT PRIMARY KEY,
      content BLOB
    );
  `);
  documentsDb.query('INSERT INTO document_documents (document_id, collection_id, name, kind) VALUES (?, ?, ?, ?)').run(
    'doc-1',
    'col-research',
    'notes.txt',
    'file',
  );
  documentsDb.query('INSERT INTO document_versions (version_id, document_id, content_hash, observed_at) VALUES (?, ?, ?, ?)').run(
    'ver-1',
    'doc-1',
    contentHash,
    now,
  );
  documentsDb.query('INSERT INTO document_bytes (version_id, content) VALUES (?, ?)').run('ver-1', Buffer.from(sourceText));
  documentsDb.close();

  return { noteId: note.id, conversationId, contentHash };
}

test('contentful vault-migrate encodes note, calendar, automation, memory, branched chat, prompt and source bytes', async () => {
  const { privateRoot, vaultRoot } = fixtureRoot();
  const seeded = seedLegacyStores(privateRoot);
  process.env.AIR_VAULT_ROOT = vaultRoot;

  await runVaultMigrate({ root: vaultRoot, privateRoot, dryRun: false });

  expect(readVaultVersion(vaultRoot)).toBe(1);
  expect(existsSync(join(privateRoot, 'backup', 'pre-vault'))).toBe(true);
  expect(existsSync(join(privateRoot, 'rich-documents.sqlite'))).toBe(false);

  const notes = createVaultRichDocumentStore(vaultRoot);
  const calendar = createVaultCalendarStore(vaultRoot);
  const automations = createVaultAutomationStore({ vaultRoot });
  const memory = createVaultMemoryStore(vaultRoot);
  const chats = createVaultConversationStore(vaultRoot);
  const methods = createVaultMethodsStore(vaultRoot);
  try {
    const note = notes.get(seeded.noteId);
    expect(note?.title).toBe('Migration note');
    expect(note?.path).toMatch(/programs\/general\/notes\/migration-note\.note\.json$/);

    expect(calendar.lists()).toContainEqual(expect.objectContaining({ id: 'cal-work', name: 'Work' }));
    expect(calendar.events('cal-work')).toContainEqual(expect.objectContaining({ id: 'evt-1', title: 'Planning' }));

    expect(automations.list()).toContainEqual(expect.objectContaining({ id: 'auto-daily', name: 'Daily brief' }));

    memory.setEnabled(true);
    expect(memory.list()).toContainEqual(expect.objectContaining({ id: 'fact-1', content: 'Prefers concise answers' }));

    const graph = chats.load(seeded.conversationId);
    expect(graph?.conversation.title).toBe('Branched chat');
    expect(graph?.messages.map((message) => message.id).sort()).toEqual(['m1', 'm2', 'm3']);
    expect(graph?.messages.find((message) => message.id === 'm3')?.parentId).toBe('m1');

    expect(methods.list()).toContainEqual(expect.objectContaining({
      kind: 'prompt',
      value: expect.objectContaining({ id: 'prompt-brief', instructions: expect.stringContaining('Summarize {{topic}}.') }),
    }));

    const original = join(vaultRoot, 'sources', 'col-research', 'originals', `${seeded.contentHash}.txt`);
    expect(existsSync(original)).toBe(true);
  } finally {
    notes.close?.();
    calendar.close?.();
    automations.close?.();
    memory.close?.();
    chats.close?.();
    methods.close?.();
  }
}, 30_000);
