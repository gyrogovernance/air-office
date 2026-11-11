import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureVaultLayout, writeVaultVersion } from '../../../packages/vault/src/vault.service.public';
import { slugify, VAULT_PATHS } from '../../../packages/vault/src/vault.domain.public';
import { atomicWriteText } from '../../../packages/vault/src/atomic-write.adapter';
import { withProjection } from '../../../packages/vault/src/note-projection.domain.public';
import { serializeCalendarIcs } from '../../../packages/vault/src/ics.codec.public';
import { serializeAutomationYaml, type VaultAutomationDefinition, type VaultWorkflowStep } from '../../../packages/vault/src/automation-yaml.codec.public';
import { serializeFrontmatter } from '../../../packages/vault/src/frontmatter.codec.public';
import { serializeJsonl } from '../../../packages/vault/src/jsonl.codec.public';
import { writeSourceOriginal } from '../../../packages/vault/src/sources.codec.public';
import { nativeBodyToMarkdown } from '../../../packages/editor/src/rich-document-native-bridge.domain.public';

export type VaultMigrateOptions = {
  root?: string;
  privateRoot?: string;
  dryRun?: boolean;
};

type MigrateFailure = { type: string; id: string; reason: string };

function openDb(path: string): Database | null {
  if (!existsSync(path)) return null;
  return new Database(path, { readonly: true });
}

function fail(failures: MigrateFailure[], type: string, id: string, reason: string): never {
  failures.push({ type, id, reason });
  throw new Error(`${type} ${id}: ${reason}`);
}

function moveToBackup(source: string, backupRoot: string): void {
  if (!existsSync(source)) return;
  mkdirSync(backupRoot, { recursive: true });
  const target = join(backupRoot, source.replace(/[\\/:]/g, '_'));
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
}

/**
 * Fail-fast migrator: encode legacy SQLite/JSON stores into the vault, write
 * vault-version, and move old databases to backup/pre-vault/.
 */
export async function runVaultMigrate(options: VaultMigrateOptions = {}): Promise<void> {
  const failures: MigrateFailure[] = [];
  const privateRoot = options.privateRoot?.trim() || process.env.OFFICE_RUNTIME_DIR?.trim() || join(process.cwd(), '.tmp', 'runtime');
  const vaultRoot = options.root?.trim() || process.env.AIR_VAULT_ROOT?.trim() || join(privateRoot, 'vault');
  process.env.AIR_VAULT_ROOT = vaultRoot;

  const paths = ensureVaultLayout(vaultRoot);
  const backupRoot = join(privateRoot, 'backup', 'pre-vault');
  const dryRun = options.dryRun === true;

  try {
    migrateNotes(privateRoot, vaultRoot, failures, dryRun);
    migrateCalendar(privateRoot, vaultRoot, failures, dryRun);
    migrateAutomations(privateRoot, vaultRoot, failures, dryRun);
    migrateMemory(privateRoot, vaultRoot, failures, dryRun);
    migrateChat(privateRoot, vaultRoot, failures, dryRun);
    migrateMethods(privateRoot, vaultRoot, failures, dryRun);
    migrateDocuments(privateRoot, vaultRoot, failures, dryRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`vault-migrate failed: ${message}`);
    for (const item of failures) console.error(`- ${item.type} ${item.id}: ${item.reason}`);
    process.exitCode = 1;
    return;
  }

  if (!dryRun) {
    writeVaultVersion(vaultRoot, 1);
    const documentsDbPath = process.env.OFFICE_DOCUMENTS_DATABASE_PATH?.trim() || join(privateRoot, 'documents.sqlite');
    for (const name of [
      'rich-documents.sqlite',
      'calendar.sqlite',
      'automations.sqlite',
      'memory.sqlite',
      'chat.sqlite',
      'methods.sqlite',
      'knowledge.sqlite',
      'tools.sqlite',
    ]) {
      moveToBackup(join(privateRoot, name), backupRoot);
      const documentsDir = join(privateRoot, `${name}.documents`);
      if (existsSync(documentsDir)) moveToBackup(documentsDir, backupRoot);
    }
    moveToBackup(documentsDbPath, backupRoot);
    const documentsDir = `${documentsDbPath}.documents`;
    if (existsSync(documentsDir)) moveToBackup(documentsDir, backupRoot);
  }

  console.log(`vault-migrate complete: ${vaultRoot}`);
  console.log(`vault-version written; legacy DBs ${dryRun ? 'would move' : 'moved'} to ${backupRoot}`);
}

function migrateNotes(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'rich-documents.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  const rows = db.query<{ document_json: string }, []>('SELECT document_json FROM rich_documents').all();
  for (const row of rows) {
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(row.document_json) as Record<string, unknown>;
    } catch (error) {
      fail(failures, 'note', 'unknown', `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const id = typeof document.id === 'string' ? document.id : '';
    if (!id) fail(failures, 'note', 'unknown', 'missing id');
    const title = typeof document.title === 'string' ? document.title : 'Untitled note';
    const slug = slugify(title) || slugify(id);
    const program = 'general';
    const jsonRel = `${VAULT_PATHS.programs}/${program}/notes/${slug}.note.json`;
    const mdRel = `${VAULT_PATHS.programs}/${program}/notes/${slug}.md`;
    let markdown = '';
    try {
      markdown = nativeBodyToMarkdown(document.body);
    } catch (error) {
      fail(failures, 'note', id, `body could not convert to markdown: ${error instanceof Error ? error.message : String(error)}`);
    }
    const projected = withProjection(
      {
        format: String(document.format ?? 'air-office.rich-document'),
        id,
        title,
        updatedAt: String(document.updatedAt ?? new Date().toISOString()),
        body: document.body,
        attachments: Array.isArray(document.attachments) ? document.attachments : [],
      },
      mdRel,
      markdown,
    );
    if (!dryRun) {
      atomicWriteText(join(vaultRoot, ...jsonRel.split('/')), `${JSON.stringify(projected)}\n`);
      atomicWriteText(join(vaultRoot, ...mdRel.split('/')), markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    }
  }
  db.close();
}

function migrateCalendar(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'calendar.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  const listRows: { id: string; name: string; color: string; visible: boolean; createdAt: string; updatedAt: string }[] = [];
  try {
    const payloadRows = db.query<{ value_json: string }, []>('SELECT value_json FROM calendar_lists').all();
    for (const row of payloadRows) {
      listRows.push(JSON.parse(row.value_json) as { id: string; name: string; color: string; visible: boolean; createdAt: string; updatedAt: string });
    }
  } catch (error) {
    fail(failures, 'calendar', 'lists', `unreadable calendar store: ${error instanceof Error ? error.message : String(error)}`);
  }

  let eventRows: Record<string, unknown>[] = [];
  try {
    eventRows = db.query<{ value_json: string }, []>('SELECT value_json FROM calendar_events').all()
      .map((row) => JSON.parse(row.value_json) as Record<string, unknown>);
  } catch (error) {
    fail(failures, 'calendar', 'events', `unreadable events: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const list of listRows) {
    const events = eventRows
      .filter((event) => String(event.calendarId ?? event.calendar_id) === list.id)
      .map((event) => ({
        id: String(event.id),
        calendarId: list.id,
        title: String(event.title),
        date: String(event.date),
        ...(event.time || event.time === '' ? { time: String(event.time) } : {}),
        allDay: Boolean(event.allDay ?? event.all_day),
        timezone: String(event.timezone ?? 'UTC'),
        ...(event.location ? { location: String(event.location) } : {}),
        ...(event.description ? { description: String(event.description) } : {}),
        ...(event.recurrence && typeof event.recurrence === 'object' ? { recurrence: event.recurrence as never } : {}),
        ...(event.reminderMinutes !== undefined || event.reminder_minutes !== undefined
          ? { reminderMinutes: Number(event.reminderMinutes ?? event.reminder_minutes) }
          : {}),
        ...(event.automationId || event.automation_id ? { automationId: String(event.automationId ?? event.automation_id) } : {}),
        ...(event.automationOccurrenceId || event.automation_occurrence_id
          ? { automationOccurrenceId: String(event.automationOccurrenceId ?? event.automation_occurrence_id) }
          : {}),
        createdAt: String(event.createdAt ?? event.created_at ?? new Date().toISOString()),
        updatedAt: String(event.updatedAt ?? event.updated_at ?? new Date().toISOString()),
      }));
    const ics = serializeCalendarIcs(list, events);
    const rel = `${VAULT_PATHS.calendar}/${slugify(list.name || list.id)}.ics`;
    if (!dryRun) atomicWriteText(join(vaultRoot, ...rel.split('/')), ics);
  }
  db.close();
}

function migrateAutomations(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'automations.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  let rows: Record<string, unknown>[] = [];
  try {
    rows = db.query<{ payload: string }, []>('SELECT payload FROM automation_definitions').all()
      .map((row) => JSON.parse(row.payload) as Record<string, unknown>);
  } catch {
    try {
      rows = db.query('SELECT * FROM automation_definitions').all() as Record<string, unknown>[];
    } catch (error) {
      fail(failures, 'automation', 'definitions', `unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const row of rows) {
    const id = String(row.id ?? '');
    if (!id) fail(failures, 'automation', 'unknown', 'missing id');
    const stepsRaw = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
    if (!Array.isArray(stepsRaw)) fail(failures, 'automation', id, 'steps missing');
    const steps: VaultWorkflowStep[] = [];
    for (const step of stepsRaw) {
      if (!step || typeof step !== 'object') fail(failures, 'automation', id, 'invalid step');
      const record = step as Record<string, unknown>;
      switch (record.kind) {
        case 'prompt':
          steps.push({ kind: 'prompt', prompt: String(record.prompt ?? ''), ...(record.providerId ? { providerId: String(record.providerId) } : {}), ...(record.modelId ? { modelId: String(record.modelId) } : {}) });
          break;
        case 'action': {
          const actionId = String(record.actionId ?? '');
          if (!actionId) fail(failures, 'automation', id, 'action step missing actionId');
          steps.push({
            kind: 'action',
            actionPath: `actions/${slugify(actionId)}.md`,
            source: String(record.source ?? ''),
            instructions: String(record.instructions ?? ''),
            providerId: String(record.providerId ?? ''),
            modelId: String(record.modelId ?? ''),
            ...(record.definition && typeof record.definition === 'object' ? { definition: record.definition as never } : {}),
          });
          break;
        }
        case 'tool':
          steps.push({ kind: 'tool', toolId: String(record.toolId ?? ''), input: (record.input && typeof record.input === 'object' ? record.input as Record<string, unknown> : {}) });
          break;
        case 'calendar-event': {
          const calendarId = String(record.calendarId ?? '');
          if (!calendarId) fail(failures, 'automation', id, 'calendar-event missing calendarId');
          steps.push({
            kind: 'calendar-event',
            calendarPath: `calendar/${slugify(calendarId)}.ics`,
            title: String(record.title ?? ''),
            daysAfterRun: Number(record.daysAfterRun ?? 0),
            allDay: Boolean(record.allDay),
            ...(record.time ? { time: String(record.time) } : {}),
          });
          break;
        }
        case 'chat-message': {
          const conversationId = String(record.conversationId ?? '');
          if (!conversationId) fail(failures, 'automation', id, 'chat-message missing conversationId');
          steps.push({
            kind: 'chat-message',
            conversationPath: `programs/general/chats/${conversationId}/`,
          });
          break;
        }
        default:
          fail(failures, 'automation', id, `unknown step kind ${String(record.kind)}`);
      }
    }
    const recurrence = typeof row.recurrence === 'string' ? JSON.parse(row.recurrence) : row.recurrence;
    const definition: VaultAutomationDefinition = {
      schema: 'air.automation/1',
      id,
      name: String(row.name ?? id),
      enabled: Boolean(row.enabled),
      missedRunPolicy: row.missedRunPolicy === 'run-once' || row.missed_run_policy === 'run-once' ? 'run-once' : 'skip',
      recurrence: recurrence as VaultAutomationDefinition['recurrence'],
      steps,
      createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
      updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
    };
    const rel = `${VAULT_PATHS.automations}/${slugify(definition.name || id)}.automation.yaml`;
    if (!dryRun) atomicWriteText(join(vaultRoot, ...rel.split('/')), serializeAutomationYaml(definition));
  }
  db.close();
}

function migrateMemory(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'memory.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  let facts: Record<string, unknown>[] = [];
  try {
    facts = db.query('SELECT * FROM memory_facts').all() as Record<string, unknown>[];
  } catch {
    try {
      facts = db.query<{ payload: string }, []>('SELECT payload FROM memory_facts').all()
        .map((row) => JSON.parse(row.payload) as Record<string, unknown>);
    } catch (error) {
      fail(failures, 'memory', 'facts', `unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const lines = facts.map((fact) => ({
    id: String(fact.id),
    content: String(fact.content),
    conversationId: fact.conversationId ?? fact.conversation_id ?? null,
    createdAt: String(fact.createdAt ?? fact.created_at ?? new Date().toISOString()),
    updatedAt: String(fact.updatedAt ?? fact.updated_at ?? new Date().toISOString()),
  }));
  if (!dryRun) atomicWriteText(join(vaultRoot, 'memory', 'facts.jsonl'), serializeJsonl(lines));
  db.close();
}

function migrateChat(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'chat.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  let conversations: Record<string, unknown>[] = [];
  try {
    conversations = db.query('SELECT * FROM conversations').all() as Record<string, unknown>[];
  } catch (error) {
    fail(failures, 'chat', 'conversations', `unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const conversation of conversations) {
    const id = String(conversation.id ?? conversation.conversation_id ?? '');
    if (!id) fail(failures, 'chat', 'unknown', 'missing id');
    let messages: Record<string, unknown>[] = [];
    try {
      messages = db.query('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(id) as Record<string, unknown>[];
    } catch (error) {
      fail(failures, 'chat', id, `messages unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const dir = join(vaultRoot, 'programs', 'general', 'chats', id);
    const meta = {
      title: String(conversation.title ?? 'Chat'),
      pinned: Boolean(conversation.pinned),
      archivedAt: conversation.archived_at ?? conversation.archivedAt ?? null,
      tags: [],
      folderId: conversation.folder_id ?? conversation.folderId ?? null,
      unreadAt: conversation.unread_at ?? conversation.unreadAt ?? null,
      createdAt: String(conversation.created_at ?? conversation.createdAt ?? new Date().toISOString()),
      updatedAt: String(conversation.updated_at ?? conversation.updatedAt ?? new Date().toISOString()),
    };
    if (!dryRun) {
      mkdirSync(dir, { recursive: true });
      atomicWriteText(join(dir, 'meta.yaml'), Bun.YAML.stringify(meta));
      atomicWriteText(join(dir, 'messages.jsonl'), serializeJsonl(messages.map((message) => {
        const content = message.content;
        if (typeof content !== 'string') fail(failures, 'chat', id, `message ${String(message.id)} content must be a string`);
        return {
          id: String(message.id),
          conversationId: id,
          parentId: message.parent_id ?? message.parentId ?? null,
          role: String(message.role),
          content,
          complete: Boolean(message.complete ?? true),
          runId: message.run_id ?? message.runId ?? null,
          createdAt: String(message.created_at ?? message.createdAt ?? new Date().toISOString()),
        };
      })));
    }
  }
  db.close();
}

function migrateMethods(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = join(privateRoot, 'methods.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  const writeMd = (rel: string, data: Record<string, unknown>, body: string) => {
    if (!dryRun) atomicWriteText(join(vaultRoot, ...rel.split('/')), serializeFrontmatter(data, body));
  };
  try {
    const skills = db.query('SELECT * FROM reusable_skills').all() as Record<string, unknown>[];
    for (const skill of skills) {
      const id = String(skill.id);
      writeMd(`.air/skills/${slugify(id)}/SKILL.md`, {
        name: String(skill.name ?? id),
        description: String(skill.description ?? ''),
      }, String(skill.instructions ?? skill.body ?? ''));
    }
  } catch {
    // optional table
  }
  try {
    const prompts = db.query('SELECT * FROM saved_prompts').all() as Record<string, unknown>[];
    for (const prompt of prompts) {
      const id = String(prompt.id);
      const variables = typeof prompt.variables === 'string' ? JSON.parse(prompt.variables) : (prompt.variables ?? []);
      writeMd(`.air/prompts/${slugify(id)}.prompt.md`, {
        name: String(prompt.name ?? id),
        variables,
      }, String(prompt.instructions ?? prompt.body ?? ''));
    }
  } catch {
    // optional
  }
  try {
    const presets = db.query('SELECT * FROM model_presets').all() as Record<string, unknown>[];
    for (const preset of presets) {
      const id = String(preset.id);
      writeMd(`.air/agents/${slugify(id)}.agent.md`, {
        name: String(preset.name ?? id),
        description: String(preset.description ?? ''),
        model: String(preset.modelId ?? preset.model_id ?? ''),
        provider: String(preset.providerId ?? preset.provider_id ?? ''),
      }, String(preset.instructions ?? ''));
    }
  } catch {
    // optional
  }
  db.close();
  void failures;
}

function migrateDocuments(privateRoot: string, vaultRoot: string, failures: MigrateFailure[], dryRun: boolean): void {
  const dbPath = process.env.OFFICE_DOCUMENTS_DATABASE_PATH?.trim() || join(privateRoot, 'documents.sqlite');
  const db = openDb(dbPath);
  if (!db) return;
  let documents: Record<string, unknown>[] = [];
  try {
    documents = db.query('SELECT * FROM document_documents').all() as Record<string, unknown>[];
  } catch (error) {
    fail(failures, 'document', 'documents', `unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const document of documents) {
    const documentId = String(document.document_id ?? document.id ?? '');
    if (!documentId) fail(failures, 'document', 'unknown', 'missing id');
    const collectionRaw = document.collection_id ?? document.collectionId;
    const collectionId = typeof collectionRaw === 'string' && collectionRaw.trim() ? collectionRaw : null;
    const name = String(document.name ?? documentId);
    const kind = String(document.kind ?? 'file');
    let versions: Record<string, unknown>[] = [];
    try {
      versions = db.query('SELECT * FROM document_versions WHERE document_id = ?').all(documentId) as Record<string, unknown>[];
    } catch (error) {
      fail(failures, 'document', documentId, `versions unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const version of versions) {
      const versionId = String(version.version_id ?? version.versionId ?? version.id ?? '');
      if (!versionId) fail(failures, 'document', documentId, 'version missing id');
      const hash = String(version.content_hash ?? version.contentHash ?? '');
      if (!hash) fail(failures, 'document', documentId, `version ${versionId} missing content hash`);
      let bytesRow: { content: Uint8Array | Buffer | string } | null = null;
      try {
        bytesRow = db.query('SELECT content FROM document_bytes WHERE version_id = ?').get(versionId) as { content: Uint8Array | Buffer | string } | null;
      } catch (error) {
        fail(failures, 'document', documentId, `bytes unreadable for ${versionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!bytesRow?.content) fail(failures, 'document', documentId, `version ${versionId} has no document_bytes`);
      const raw = bytesRow.content;
      const bytes = typeof raw === 'string'
        ? new TextEncoder().encode(raw)
        : raw instanceof Uint8Array
          ? raw
          : new Uint8Array(raw);
      if (!dryRun) {
        const written = writeSourceOriginal({
          root: vaultRoot,
          collectionSlug: collectionId,
          name,
          kind,
          documentId,
          bytes,
          observedAt: String(version.observed_at ?? version.observedAt ?? new Date().toISOString()),
        });
        if (written.contentHash !== hash) {
          fail(failures, 'document', documentId, `version ${versionId} content hash mismatch (store ${hash}, bytes ${written.contentHash})`);
        }
      }
    }
  }
  db.close();
}
