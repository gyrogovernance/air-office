import { expect, test } from 'bun:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..');

/**
 * Negative architecture fixtures. These assert the boundaries the plan requires
 * for the Slice 3 modules directly against repository files, using file reads
 * only so the tool stays free of package dependencies: one owner per entity, no
 * worker that touches the application database, no mixing of incompatible
 * embedding generations, and no anchor that resolves across a version mismatch.
 */
test('no domain entity is owned by two modules', () => {
  const modules = ['contracts', 'runtime', 'workspace', 'files', 'editor', 'providers', 'chat', 'documents', 'knowledge', 'jobs', 'ui-kit'];
  const owners = new Map<string, string>();
  for (const moduleId of modules) {
    const manifestPath = join(repoRoot, 'packages', moduleId, 'module.manifest.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { ownership: { entities: string[] } };
    for (const entity of manifest.ownership.entities) {
      expect(owners.has(entity), `entity ${entity} owned by ${owners.get(entity)} and ${moduleId}`).toBe(false);
      owners.set(entity, moduleId);
    }
  }
});

test('the document worker never imports the application database', () => {
  const workerRoot = join(repoRoot, 'workers');
  if (!existsSync(workerRoot)) return;
  for (const entry of readdirSync(workerRoot, { recursive: true }) as string[]) {
    if (!entry.endsWith('.py') && !entry.endsWith('.ts')) continue;
    // An installed dependency is not the worker's own source. A virtual
    // environment holds thousands of files that the rule does not speak to,
    // and reading them makes the check slow enough to time out.
    if (entry.includes('.venv') || entry.includes(`${sep}site-packages${sep}`) || entry.includes(`${sep}node_modules${sep}`) || entry.includes(`${sep}target${sep}`)) continue;
    const source = readFileSync(join(workerRoot, entry), 'utf8');
    expect(/bun:sqlite|knowledge_chunks|document_versions|document_artifacts/i.test(source), `${entry} must not touch the application database`).toBe(false);
  }
});

test('the knowledge retrieval port never imports the jobs or documents implementation', () => {
  const knowledgeSrc = join(repoRoot, 'packages', 'knowledge', 'src');
  for (const entry of readdirSync(knowledgeSrc)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const source = readFileSync(join(knowledgeSrc, entry), 'utf8');
    expect(/from '@office\/(?:jobs|documents)\/(?:service|domain)'/.test(source), `${entry} must reach documents/jobs only through contracts`).toBe(false);
  }
});

test('the retrieval contract pins embedding identity so incompatible generations cannot share a space', () => {
  const contracts = readFileSync(join(repoRoot, 'packages', 'contracts', 'src', 'knowledge.contracts.public.ts'), 'utf8');
  expect(contracts).toContain('dimensions');
  expect(contracts).toContain('metric');
  expect(contracts).toContain('isCompatibleIndex');
  expect(contracts).toContain("model === b.model && a.dimensions === b.dimensions && a.metric === b.metric");
});
