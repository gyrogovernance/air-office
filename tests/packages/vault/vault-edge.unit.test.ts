import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultRichDocumentStore } from '../../../packages/editor/src/vault-rich-document.service.public';
import { createRichDocument } from '../../../packages/editor/src/rich-document.domain.public';
import { createVaultMemoryStore } from '../../../packages/memory/src/memory-store.vault.adapter';
import { createMemoryFact } from '../../../packages/memory/src/memory.domain.public';
import { createVaultConversationStore } from '../../../packages/chat/src/conversation-vault.adapter';
import { createVaultCalendarStore } from '../../../packages/calendar/src/calendar-store.vault.adapter';
import { resolveUnderVault } from '../../../packages/vault/src/vault.host.public';
import { ensureVaultLayout } from '../../../packages/vault/src/vault.service.public';

function vaultRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'air-vault-edge-'));
  process.env.AIR_VAULT_ROOT = root;
  return root;
}

describe('vault edge cases', () => {
  test('corrupt note JSON fails loudly on get/list', () => {
    const root = vaultRoot();
    try {
      const store = createVaultRichDocumentStore(root);
      const saved = store.save(createRichDocument('Edge note', 'edge-note'));
      expect(saved.path).toBeTruthy();
      writeFileSync(resolveUnderVault(root, saved.path!), '{not-json', 'utf8');
      expect(() => store.get(saved.id)).toThrow(/Invalid note JSON|JSON/i);
      expect(() => store.list()).toThrow(/Invalid note JSON|JSON/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('path escape outside vault is rejected', () => {
    const root = vaultRoot();
    try {
      expect(() => resolveUnderVault(root, '../outside.txt')).toThrow(/Invalid vault path|escapes vault|outside vault/i);
      expect(() => resolveUnderVault(root, 'programs/../../etc/passwd')).toThrow(/Invalid vault path|escapes vault|outside vault/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('corrupt facts.jsonl line fails loudly on read', () => {
    const root = vaultRoot();
    try {
      const store = createVaultMemoryStore(root);
      store.setEnabled(true);
      store.save(createMemoryFact({ content: 'remembered preference' }));
      const factsPath = join(root, 'memory', 'facts.jsonl');
      writeFileSync(factsPath, `${JSON.stringify(createMemoryFact({ content: 'ok' }))}\n{bad-line\n`, 'utf8');
      expect(() => store.list()).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('corrupt chat meta.yaml fails loudly', () => {
    const root = vaultRoot();
    try {
      const store = createVaultConversationStore(root);
      store.ensure('broken-meta');
      const meta = join(root, 'programs', 'general', 'chats', 'broken-meta', 'meta.yaml');
      writeFileSync(meta, 'title: only\nunknownKey: true\n', 'utf8');
      expect(() => store.load('broken-meta')).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('note get accepts vault-relative path as well as id', () => {
    const root = vaultRoot();
    try {
      const store = createVaultRichDocumentStore(root);
      const saved = store.save(createRichDocument('Pathable', 'pathable'));
      expect(saved.path).toBeTruthy();
      expect(store.get(saved.path!)?.id).toBe(saved.id);
      expect(store.pathOf(saved.id)).toBe(saved.path);
      const md = saved.path!.replace(/\.note\.json$/i, '.md');
      expect(store.get(md)?.id).toBe(saved.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('save refuses a different note id at an occupied path', () => {
    const root = vaultRoot();
    try {
      const store = createVaultRichDocumentStore(root);
      const saved = store.save(createRichDocument('Occupied', 'occupied'));
      const interloper = { ...createRichDocument('Interloper', 'other-id'), path: saved.path };
      expect(() => store.save(interloper)).toThrow(/already exists at this path/i);
      expect(store.get(saved.id)?.title).toBe('Occupied');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('corrupt calendar ics fails loudly on list', () => {
    const root = vaultRoot();
    try {
      ensureVaultLayout(root);
      mkdirSync(join(root, 'calendar'), { recursive: true });
      writeFileSync(join(root, 'calendar', 'broken.ics'), 'BEGIN:VCALENDAR\nNOT-AN-ICS\n', 'utf8');
      const store = createVaultCalendarStore(root);
      expect(() => store.lists()).toThrow(/Invalid calendar/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('applyMarkdown fails closed when the paired markdown file is missing', () => {
    const root = vaultRoot();
    try {
      const store = createVaultRichDocumentStore(root);
      const saved = store.save(createRichDocument('Apply edge', 'apply-edge'));
      const md = saved.path!.replace(/\.note\.json$/i, '.md');
      unlinkSync(resolveUnderVault(root, md));
      expect(() => store.applyMarkdown(saved.id)).toThrow(/missing|unavailable|Markdown/i);
      expect(store.get(saved.id)?.id).toBe(saved.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
