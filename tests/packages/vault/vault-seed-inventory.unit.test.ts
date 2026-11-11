import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePackActionsSeeded, loadLabGadgets, seedLabPack } from '../../../packages/lab-pack/src/lab-pack.service.public';
import { createVaultMethodsStore } from '../../../packages/methods/src/methods-vault.adapter';
import { createVaultRichDocumentStore } from '../../../packages/editor/src/vault-rich-document.service.public';
import { createRichDocument, markdownToNativeBody } from '../../../packages/editor/src/rich-document.domain.public';
import { createVaultWorkspaceStore } from '../../../packages/workspace/src/vault-workspace-store.adapter';
import { ensureVaultLayout, readVaultVersion, writeVaultVersion } from '../../../packages/vault/src/vault.service.public';
import { ensureVaultSettingsFiles, readModelHarnessSettingsFile, readToolsSettingsFile, readWebSearchSettingsFile } from '../../../packages/vault/src/vault-settings.authority.public';
import { exportVaultZip, importVaultZip } from '../../../packages/vault/src/vault-portable.public';
import { slugify } from '../../../packages/vault/src/vault.domain.public';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* windows locks */ }
  }
});

test('lab pack and path-first note land under the mainstream vault layout with settings yaml', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'air-seed-inventory-'));
  roots.push(vaultRoot);
  process.env.AIR_VAULT_ROOT = vaultRoot;
  ensureVaultLayout(vaultRoot);
  writeVaultVersion(vaultRoot, 1);
  ensureVaultSettingsFiles(vaultRoot);

  const methods = createVaultMethodsStore(vaultRoot);
  mkdirSync(join(vaultRoot, '.air', 'runtime'), { recursive: true });
  await seedLabPack({
    ledgerPath: join(vaultRoot, '.air', 'runtime', 'lab-pack.ledger.json'),
    methods,
  });
  ensurePackActionsSeeded(vaultRoot, loadLabGadgets());

  const packActions = readdirSync(join(vaultRoot, '.air', 'pack', 'actions')).filter((name) => name.endsWith('.md'));
  expect(packActions.length).toBeGreaterThan(0);
  expect(methods.list().length).toBeGreaterThan(0);

  const workspace = createVaultWorkspaceStore(vaultRoot);
  const program = workspace.create({ id: 'ignored', kind: 'program', name: 'Frontier Governance', instruction: 'Demo program' });
  const project = workspace.create({ id: 'ignored', kind: 'project', name: 'Deploy Gates', parentId: program.id, instruction: 'Demo project' });
  const notes = createVaultRichDocumentStore(vaultRoot);
  const programSlug = program.id.slice('program:'.length);
  const projectSlug = project.id.slice(`project:${programSlug}/`.length);
  const path = `programs/${programSlug}/projects/${projectSlug}/notes/${slugify('Safety Case')}.note.json`;
  const saved = notes.save({ ...createRichDocument('Safety Case', 'demo-research-brief'), path, body: markdownToNativeBody('## Decision\n\nPath-first seed.') });
  expect(saved.path).toBe(path);
  const noteNode = workspace.create({ id: 'ignored', kind: 'note', name: 'Safety Case', parentId: project.id, targetId: saved.path! });
  expect(noteNode.targetId).toBe(path);
  expect(noteNode.id).toBe(`note:${path}`);

  expect(readToolsSettingsFile(vaultRoot).schema).toBe('air.tools/1');
  expect(readWebSearchSettingsFile(vaultRoot).schema).toBe('air.web-search/1');
  expect(readModelHarnessSettingsFile(vaultRoot).schema).toBe('air.model-harness/1');
  expect(readVaultVersion(vaultRoot)).toBe(1);

  methods.close?.();
  notes.close?.();
  workspace.close?.();
}, 60_000);

test('portable vault zip round-trips notes and settings without runtime', async () => {
  const source = mkdtempSync(join(tmpdir(), 'air-vault-src-'));
  const destination = mkdtempSync(join(tmpdir(), 'air-vault-dst-'));
  roots.push(source, destination);
  process.env.AIR_VAULT_ROOT = source;
  ensureVaultLayout(source);
  writeVaultVersion(source, 1);
  ensureVaultSettingsFiles(source);
  mkdirSync(join(source, '.air', 'runtime'), { recursive: true });
  await Bun.write(join(source, '.air', 'runtime', 'noise.txt'), 'skip');
  mkdirSync(join(source, 'programs', 'general', 'notes'), { recursive: true });
  await Bun.write(join(source, 'programs', 'general', 'notes', 'hello.md'), '# Hello\n');
  await Bun.write(join(source, 'programs', 'general', 'notes', 'hello.note.json'), `${JSON.stringify({
    format: 'air-office.rich-document',
    id: 'hello',
    title: 'Hello',
    updatedAt: new Date().toISOString(),
    body: { type: 'doc', content: [] },
    attachments: [],
  })}\n`);

  const zip = await exportVaultZip(source);
  expect(zip.byteLength).toBeGreaterThan(32);
  await importVaultZip(zip, destination);
  expect(existsSync(join(destination, 'programs', 'general', 'notes', 'hello.note.json'))).toBe(true);
  expect(existsSync(join(destination, '.air', 'settings', 'tools.yaml'))).toBe(true);
  expect(existsSync(join(destination, '.air', 'runtime', 'noise.txt'))).toBe(false);
}, 30_000);
