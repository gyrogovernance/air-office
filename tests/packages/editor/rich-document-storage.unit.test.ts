import { describe, expect, test } from 'bun:test';
import '../../support/editor-dom.adapter';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultRichDocumentStore } from '../../../packages/editor/src/rich-document.service.public';
import { createRichDocument, markdownToNativeBody, validateRichDocument } from '../../../packages/editor/src/rich-document.domain.public';
import { pairPathsFromNotePath } from '../../../packages/vault/src/note-projection.domain.public';

function vaultFixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-vault-notes-'));
  process.env.AIR_VAULT_ROOT = root;
  const store = createVaultRichDocumentStore(root);
  return {
    root,
    store,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('vault rich document storage', () => {
  test('save writes note.json and markdown projection under programs/general/notes', () => {
    const f = vaultFixture();
    try {
      const saved = f.store.save(createRichDocument('Proposal', 'proposal-1'));
      expect(validateRichDocument(saved)).toBe(true);
      expect(saved.path).toBe('programs/general/notes/proposal.note.json');
      expect(saved.programSlug).toBe('general');
      expect(saved.slug).toBe('proposal');
      expect(saved.projection?.markdownPath).toBe('programs/general/notes/proposal.md');
      expect(existsSync(join(f.root, saved.path!))).toBe(true);
      expect(existsSync(join(f.root, saved.projection!.markdownPath))).toBe(true);
      expect(f.store.get('proposal-1')?.title).toBe('Proposal');
      expect(f.store.list().map((item) => item.id)).toEqual(['proposal-1']);
    } finally {
      f.close();
    }
  });

  test('invalid note JSON fails loud on read', () => {
    const f = vaultFixture();
    try {
      const path = join(f.root, 'programs', 'general', 'notes', 'broken.note.json');
      writeFileSync(path, '{not-json', 'utf8');
      expect(() => f.store.list()).toThrow(/Invalid note JSON/);
    } finally {
      f.close();
    }
  });

  test('markdown drift apply converts md to body and discard regenerates md', () => {
    const f = vaultFixture();
    try {
      const saved = f.store.save({ ...createRichDocument('Drift', 'drift-1'), body: markdownToNativeBody('Original') });
      const markdownPath = join(f.root, pairPathsFromNotePath(saved.path!).markdownPath);
      writeFileSync(markdownPath, 'Edited on disk', 'utf8');
      expect(f.store.drift(saved.id).kind).toBe('markdown-drift');
      const applied = f.store.applyMarkdown(saved.id);
      expect(applied.warnings.length).toBeGreaterThan(0);
      expect(f.store.drift(saved.id).kind).toBe('ok');
      writeFileSync(markdownPath, 'Drift again', 'utf8');
      expect(f.store.drift(saved.id).kind).toBe('markdown-drift');
      f.store.discardMarkdown(saved.id);
      expect(readFileSync(markdownPath, 'utf8')).not.toBe('Drift again');
      expect(f.store.drift(saved.id).kind).toBe('ok');
    } finally {
      f.close();
    }
  });

  test('applyMarkdown materializes a lone notes/*.md then applies supplied markdown', () => {
    const f = vaultFixture();
    try {
      const notesDir = join(f.root, 'programs', 'general', 'notes');
      writeFileSync(join(notesDir, 'tool-e2e-probe.md'), '# Tool E2E Probe\n\nOriginal line.\n', 'utf8');
      const applied = f.store.applyMarkdown('programs/general/notes/tool-e2e-probe.md', '# Tool E2E Probe\n\nApplied markdown note.\n');
      expect(existsSync(join(notesDir, 'tool-e2e-probe.note.json'))).toBe(true);
      expect(readFileSync(join(notesDir, 'tool-e2e-probe.md'), 'utf8')).toContain('Applied markdown note.');
      expect(applied.document.path).toBe('programs/general/notes/tool-e2e-probe.note.json');
    } finally {
      f.close();
    }
  });

  test('applyMarkdown fails loud when notes markdown is missing or outside notes/', () => {
    const f = vaultFixture();
    try {
      expect(() => f.store.applyMarkdown('programs/general/notes/does-not-exist.md')).toThrow(
        'Note markdown not found: programs/general/notes/does-not-exist.md',
      );
      expect(() => f.store.applyMarkdown('programs/general/instruction.md')).toThrow(
        'apply_markdown_note requires a path under a notes/ folder.',
      );
    } finally {
      f.close();
    }
  });

  test('trash and restore move note pairs under .air/trash', () => {
    const f = vaultFixture();
    try {
      const saved = f.store.save(createRichDocument('Recoverable', 'recoverable-1'));
      expect(f.store.trash(saved.id)).toBe(true);
      expect(f.store.get(saved.id)).toBeNull();
      expect(f.store.trashed().map((item) => item.id)).toEqual(['recoverable-1']);
      expect(f.store.restore(saved.id)?.id).toBe('recoverable-1');
      expect(f.store.get(saved.id)?.title).toBe('Recoverable');
    } finally {
      f.close();
    }
  });

  test('clearAll removes active and trashed vault notes', () => {
    const f = vaultFixture();
    try {
      f.store.save(createRichDocument('Active', 'active-1'));
      const trashed = f.store.save(createRichDocument('Trashed', 'trashed-1'));
      f.store.trash(trashed.id);
      expect(f.store.clearAll()).toBe(2);
      expect(f.store.list()).toEqual([]);
      expect(f.store.trashed()).toEqual([]);
    } finally {
      f.close();
    }
  });
});
