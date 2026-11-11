import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leanCreate, leanDelete, leanEdit, leanGlob, leanGrep, leanMove, leanPathKind, leanView } from '../../../packages/tools/src/lean-file-tools.adapter';
import { existsSync, readFileSync } from 'node:fs';

describe('lean file tools', () => {
  test('view/create/edit/glob/grep stay inside vault roots and enforce edit uniqueness', () => {
    const root = mkdtempSync(join(tmpdir(), 'air-lean-'));
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes', 'a.md'), 'hello world\nhello again\n', 'utf8');
    const roots = { vaultRoot: root };

    expect(leanView({ path: 'notes/a.md' }, roots).content).toContain('hello world');
    expect(leanView({ path: 'notes/a.md', view_range: [1, 1] }, roots).content).toBe('hello world');

    expect(() => leanCreate({ path: 'notes/a.md', file_text: 'x' }, roots)).toThrow(/already exists/);
    expect(leanCreate({ path: 'notes/b.md', file_text: 'one occurrence\n' }, roots)).toEqual({ path: 'notes/b.md', created: true });

    expect(() => leanEdit({ path: 'notes/a.md', old_str: 'hello', new_str: 'hi' }, roots)).toThrow(/more than once/);
    expect(leanEdit({ path: 'notes/b.md', old_str: 'one occurrence', new_str: 'replaced' }, roots)).toEqual({ path: 'notes/b.md', replaced: true });
    expect(leanView({ path: 'notes/b.md' }, roots).content).toBe('replaced\n');

    expect(leanGlob({ pattern: 'notes/*.md' }, roots).matches).toContain('notes/a.md');
    const grep = leanGrep({ pattern: 'world', path: 'notes' }, roots) as { matches: { path: string }[] };
    expect(grep.matches.some((hit) => hit.path.includes('a.md'))).toBe(true);

    expect(() => leanView({ path: '../escape.md' }, roots)).toThrow();
  });

  test('delete and move stay confined and move note pairs together', () => {
    const root = mkdtempSync(join(tmpdir(), 'air-lean-dm-'));
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'notes', 'plain.txt'), 'x\n', 'utf8');
    writeFileSync(join(root, 'notes', 'pair.md'), '# Hi\n', 'utf8');
    writeFileSync(join(root, 'notes', 'pair.note.json'), '{"id":"1"}\n', 'utf8');
    const roots = { vaultRoot: root };

    expect(leanDelete({ path: 'notes/plain.txt' }, roots)).toEqual({ path: 'notes/plain.txt', deleted: true });
    expect(existsSync(join(root, 'notes', 'plain.txt'))).toBe(false);
    expect(() => leanDelete({ path: '../escape.txt' }, roots)).toThrow();
    expect(() => leanDelete({ path: 'notes' }, roots)).toThrow(/files/);

    expect(leanMove({ path: 'notes/pair.md', to: 'notes/renamed.md' }, roots)).toMatchObject({
      path: 'notes/renamed.md',
      from: 'notes/pair.md',
      paired: 'notes/renamed.note.json',
    });
    expect(existsSync(join(root, 'notes', 'pair.md'))).toBe(false);
    expect(existsSync(join(root, 'notes', 'pair.note.json'))).toBe(false);
    expect(readFileSync(join(root, 'notes', 'renamed.md'), 'utf8')).toContain('# Hi');
    expect(existsSync(join(root, 'notes', 'renamed.note.json'))).toBe(true);
    expect(leanPathKind('notes/renamed.md', roots)).toEqual({ path: 'notes/renamed.md', kind: 'note' });
    expect(() => leanMove({ path: 'notes/renamed.md', to: '../outside.md' }, roots)).toThrow();
  });

  test('rejects a directory symlink or junction that resolves outside vault roots', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'air-lean-symlink-'));
    const root = join(sandbox, 'vault');
    const outside = join(sandbox, 'outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.md'), 'secret\n', 'utf8');
    try {
      symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      // Junction/symlink creation may be unavailable on this host; skip rather than fail.
      return;
    }
    const roots = { vaultRoot: root };
    expect(() => leanView({ path: 'linked/secret.md' }, roots)).toThrow(/outside the Library/);
    expect(() => leanCreate({ path: 'linked/new.md', file_text: 'x\n' }, roots)).toThrow(/outside the Library/);
  });

  test('rejects Keys roots and Library system paths', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'air-lean-deny-'));
    const library = join(sandbox, 'library');
    const privateRoot = join(sandbox, 'private');
    mkdirSync(join(library, '.air', 'runtime'), { recursive: true });
    mkdirSync(join(library, '.air', 'settings'), { recursive: true });
    mkdirSync(join(library, 'notes'), { recursive: true });
    mkdirSync(join(privateRoot, 'provider-credentials'), { recursive: true });
    writeFileSync(join(library, 'notes', 'ok.md'), 'ok\n', 'utf8');
    writeFileSync(join(library, '.air', 'runtime', 'chat.sqlite'), 'x', 'utf8');
    writeFileSync(join(library, '.air', 'settings', 'tools.yaml'), 'tools: {}\n', 'utf8');
    writeFileSync(join(privateRoot, 'provider-credentials', 'key.txt'), 'secret\n', 'utf8');
    const roots = { vaultRoot: library, deniedRoots: [privateRoot] };

    expect(leanView({ path: 'notes/ok.md' }, roots).content).toBe('ok\n');
    expect(() => leanView({ path: '.air/runtime/chat.sqlite' }, roots)).toThrow(/reserved/);
    expect(() => leanView({ path: '.air/settings/tools.yaml' }, roots)).toThrow(/reserved/);
    expect(() => leanView({ path: join(privateRoot, 'provider-credentials', 'key.txt') }, roots)).toThrow();
    expect(leanGlob({ pattern: '**/*', path: '.' }, roots).matches).toEqual(['notes/ok.md']);
  });
});
