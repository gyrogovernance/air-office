import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectiveInstructions, isAiSafetySkill, resolveMethodInstructions, resolvePrompt, validateDefinition, validateMethodsBundle, type MethodDefinition, type MethodVersion, type SavedPrompt } from '../../../packages/methods/src/methods.domain.public';
import { createSqliteCraftStore, createVaultMethodsStore } from '../../../packages/methods/src/methods.service.public';

const summaryPreset: MethodDefinition = { kind: 'preset', value: { id: 'preset-summary', name: 'Short summary', model: 'demo-model', instructions: 'Summarise the selection in three sentences.', settings: { temperature: 0.2 }, knowledgeCollectionIds: [], skillIds: [], toolIds: [], updatedAt: new Date().toISOString() } };
const rewritePrompt: SavedPrompt = { id: 'prompt-rewrite', name: 'Rewrite', instructions: 'Rewrite {{selection}} in the voice of {{audience}}.', variables: ['selection', 'audience'], updatedAt: new Date().toISOString() };
const formatSkill: MethodDefinition = { kind: 'skill', value: { id: 'skill-format', name: 'Heading formatter', description: 'Turns a line into a heading.', instructions: 'Convert the line into a level-two heading.', updatedAt: new Date().toISOString() } };

function withVaultMethodsStore() {
  const root = mkdtempSync(join(tmpdir(), 'air-methods-'));
  process.env.AIR_VAULT_ROOT = root;
  const store = createVaultMethodsStore(root);
  return {
    root,
    store,
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('methods domain', () => {
  test('resolves prompt variables and reports the ones still missing', () => {
    const resolved = resolvePrompt(rewritePrompt, { selection: 'the abstract', audience: 'a newcomer' });
    expect(resolved.content).toBe('Rewrite the abstract in the voice of a newcomer.');
    expect(resolved.missing).toEqual([]);
    const partial = resolvePrompt(rewritePrompt, { selection: 'the abstract' });
    expect(partial.missing).toEqual(['audience']);
    expect(partial.content).toContain('{{audience}}');
  });
  test('resolves each attached prompt separately and reports blank or undeclared references', () => {
    const definitions: MethodDefinition[] = [summaryPreset, { kind: 'prompt', value: { ...rewritePrompt, variables: ['selection'] } }, formatSkill];
    expect(resolveMethodInstructions(definitions, { 'prompt-rewrite': { selection: '   ' } }).missing).toEqual(['Rewrite: selection', 'Rewrite: audience']);
    const result = resolveMethodInstructions(definitions, { 'prompt-rewrite': { selection: 'the abstract', audience: 'a newcomer' } });
    expect(result.missing).toEqual([]);
    expect(result.content).toContain('Rewrite the abstract in the voice of a newcomer.');
    expect(result.content).toContain('SKILL: Heading formatter');
    expect(rewritePrompt.instructions).toContain('{{selection}}');
  });
  test('validates definitions and portable bundles across kinds', () => {
    expect(validateDefinition(summaryPreset)).toBe(true);
    expect(validateDefinition({ kind: 'prompt', value: rewritePrompt })).toBe(true);
    expect(validateDefinition(formatSkill)).toBe(true);
    expect(validateDefinition({ kind: 'prompt', value: { ...rewritePrompt, variables: ['Not Valid'] } })).toBe(false);
    expect(validateDefinition({ kind: 'preset', value: { ...summaryPreset.value, model: undefined } })).toBe(false);
    expect(validateMethodsBundle({ format: 'air-office.methods', version: 1, definitions: [summaryPreset, { kind: 'prompt', value: rewritePrompt }] })).toBe(true);
    expect(validateMethodsBundle({ format: 'air-office.methods', version: 2, definitions: [] })).toBe(false);
  });
  test('rejects malformed settings, identities, timestamps, and cross-kind fields', () => {
    for (const patch of [
      { id: ' ' }, { updatedAt: '' }, { updatedAt: '2026-02-30T00:00:00Z' },
      { model: '' }, { provider: 42 }, { settings: [] },
      { settings: { temperature: NaN } }, { settings: { temperature: 2.1 } },
      { settings: { maxOutputTokens: 1.5 } }, { settings: { maxOutputTokens: 0 } },
      { settings: { unknown: true } }, { toolIds: [''] }, { toolIds: ['a', 'a'] },
      { variables: [] }, { instructions: undefined }
    ]) expect(validateDefinition({ kind: 'preset', value: { ...summaryPreset.value, ...patch } })).toBe(false);
    expect(validateDefinition({ kind: 'prompt', value: { ...rewritePrompt, variables: ['selection', 'selection'] } })).toBe(false);
    expect(validateDefinition({ kind: 'skill', value: { ...formatSkill.value, description: 'x'.repeat(501) } })).toBe(false);
    expect(validateMethodsBundle({ format: 'air-office.methods', version: 1, definitions: [summaryPreset, summaryPreset] })).toBe(false);
    expect(validateMethodsBundle({ format: 'air-office.methods', version: 1, definitions: [], extra: true })).toBe(false);
    expect(validateDefinition({ ...summaryPreset, value: { ...summaryPreset.value, updatedAt: '2026-10-12T01:00:00+02:00' } })).toBe(true);
  });
  test('composes effective instructions for a selected set', () => {
    expect(effectiveInstructions([summaryPreset, formatSkill])).toContain('AGENT: Short summary');
    expect(effectiveInstructions([summaryPreset, formatSkill])).toContain('SKILL: Heading formatter');
  });
  test('an agent reaches the model with the skills it names', () => {
    const agent: MethodDefinition = { kind: 'preset', value: { ...summaryPreset.value, skillIds: ['skill-format'] } };
    const resolved = resolveMethodInstructions([agent], {}, [agent, formatSkill]);
    expect(resolved.content).toContain('SKILL: Heading formatter');
    expect(resolved.content).toContain('Convert the line into a level-two heading.');
    // A skill attached to the chat is not repeated when the agent names it.
    const both = resolveMethodInstructions([agent, formatSkill], {}, [agent, formatSkill]);
    expect(both.content.match(/SKILL: Heading formatter/g)).toHaveLength(1);
    // A named skill that is not in the catalogue is left out rather than
    // reaching the model as an empty section.
    const missing: MethodDefinition = { kind: 'preset', value: { ...summaryPreset.value, skillIds: ['skill-absent'] } };
    expect(resolveMethodInstructions([missing], {}, [missing, formatSkill]).content).not.toContain('SKILL:');
  });
  test('catalog skill delivery names skills without pasting their bodies', () => {
    const agent: MethodDefinition = { kind: 'preset', value: { ...summaryPreset.value, skillIds: ['skill-format'] } };
    const catalogued = resolveMethodInstructions([agent], {}, [agent, formatSkill], { skillBodies: 'catalog' });
    expect(catalogued.content).toContain('Available skills (load with the skill tool when needed)');
    expect(catalogued.content).toContain('Heading formatter');
    expect(catalogued.content).not.toContain('Convert the line into a level-two heading.');
  });
  test('recognizes AI-safety skills for standing filters', () => {
    expect(isAiSafetySkill({ id: 'lab-skill-the-human-mark', name: 'The Human Mark', description: '', instructions: '' })).toBe(true);
    expect(isAiSafetySkill({ id: 'skill-owasp', name: 'Advisor', description: 'Review', instructions: 'Library: OWASP GenAI Security Advisor\nCategory: AI security\n' })).toBe(true);
    expect(isAiSafetySkill(formatSkill.value)).toBe(false);
  });
});

describe('methods store', () => {
  test("new craft stores enable the built-in standards and retain a person's choice", () => {
    const root = mkdtempSync(join(tmpdir(), 'air-crafts-'));
    const store = createSqliteCraftStore(join(root, 'crafts.sqlite'));
    try {
      const standards = store.list();
      expect(standards).toHaveLength(2);
      expect(standards.every((record) => record.enabled)).toBe(true);
      store.save({ ...standards[0]!, enabled: false });
      expect(store.list().find((record) => record.package.id === standards[0]!.package.id)?.enabled).toBe(false);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('stores craft-prefixed skill ids on disk without colon path segments', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { root, store } = fixture;
      const craftSkill: MethodDefinition = {
        kind: 'skill',
        value: {
          id: 'craft:owasp-secure-agent-playbook:agent-security-audit',
          name: 'Agent Security Audit',
          description: 'Audit agent configs.',
          instructions: 'Review permissions and injection surfaces.',
          updatedAt: new Date().toISOString(),
        },
      };
      store.save(craftSkill);
      const folders = readdirSync(join(root, '.air', 'skills'));
      expect(folders.some((name) => name.includes(':'))).toBe(false);
      expect(folders).toContain(encodeURIComponent(craftSkill.value.id));
      expect(store.get(craftSkill.value.id)?.value.name).toBe('Agent Security Audit');
    } finally {
      fixture.close();
    }
  });

  test('persists definitions with automatic version history and restore', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { store } = fixture;
      store.save(summaryPreset);
      const edited = { kind: 'preset', value: { ...summaryPreset.value, instructions: 'Summarise in one sentence.' } } as MethodDefinition;
      store.save(edited);
      expect(store.list().length).toBe(1);
      const history = store.history('preset-summary');
      expect(history.length).toBe(2);
      const oldest = history[history.length - 1]!;
      const restored = store.restore(oldest.id);
      expect(restored && restored.kind === 'preset' && restored.value.instructions.trim()).toBe('Summarise the selection in three sentences.');
      expect(store.history('preset-summary').length).toBe(3);
    } finally {
      fixture.close();
    }
  });
  test('preserves edits and history on import collisions while importing new identities', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { store } = fixture;
      store.save(summaryPreset);
      const edited = { kind: 'preset', value: { ...summaryPreset.value, instructions: 'Keep my local changes.' } } as MethodDefinition;
      store.save(edited);
      const result = store.importBundle({ format: 'air-office.methods', version: 1, definitions: [summaryPreset, formatSkill] });
      expect(result.conflicts).toEqual([{ id: 'preset-summary', existingKind: 'preset', incomingKind: 'preset' }]);
      expect(result.imported.map((definition) => definition.value.id)).toEqual(['skill-format']);
      expect(store.get('preset-summary')?.value.instructions.trim()).toBe('Keep my local changes.');
      expect(store.history('preset-summary')).toHaveLength(2);
      const crossKind = { kind: 'prompt', value: { ...rewritePrompt, id: 'preset-summary' } } as MethodDefinition;
      expect(store.importBundle({ format: 'air-office.methods', version: 1, definitions: [crossKind] }).conflicts[0]?.incomingKind).toBe('prompt');
      expect(() => store.save(crossKind)).toThrow('cannot change kind');
      expect(store.exportBundle().definitions).toHaveLength(2);
      const again = store.importBundle(store.exportBundle());
      expect(again.imported).toHaveLength(0);
      expect(again.conflicts).toHaveLength(2);
      const detached = store.get('preset-summary')!;
      detached.value.instructions = 'mutated';
      expect(store.get('preset-summary')?.value.instructions.trim()).toBe('Keep my local changes.');
    } finally {
      fixture.close();
    }
  });
  test('rejects the complete invalid bundle before saving any definition', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { store } = fixture;
      for (const definitions of [ [summaryPreset, { kind: 'skill', value: {} }], [summaryPreset, summaryPreset] ]) {
        expect(() => store.importBundle({ format: 'air-office.methods', version: 1, definitions })).toThrow();
        expect(store.list()).toEqual([]);
        expect(store.history('preset-summary')).toEqual([]);
      }
      expect(() => store.importBundle({ format: 'air-office.methods', version: 2, definitions: [] })).toThrow();
    } finally {
      fixture.close();
    }
  });
  test('records vault history files under .air/runtime/methods for each save', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { root, store } = fixture;
      store.save(summaryPreset);
      store.save(formatSkill);
      const historyRoot = join(root, '.air', 'runtime', 'methods');
      expect(readdirSync(historyRoot).sort()).toEqual(['preset-summary', 'skill-format']);
      expect(readdirSync(join(historyRoot, 'preset-summary')).filter((name) => name.endsWith('.json'))).toHaveLength(1);
      expect(store.list().map((definition) => definition.value.id).sort()).toEqual(['preset-summary', 'skill-format']);
    } finally {
      fixture.close();
    }
  });
  test('checks restore target identity and rejects corrupted version payloads', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { root, store } = fixture;
      store.save(summaryPreset);
      store.save(formatSkill);
      const version = store.history('preset-summary')[0]!;
      expect(store.restore(version.id, 'skill-format')).toBeNull();
      expect(store.restore('missing', 'preset-summary')).toBeNull();
      expect(store.history('preset-summary')).toHaveLength(1);
      expect(store.restore(version.id, 'preset-summary')?.value.id).toBe('preset-summary');
      expect(store.history('preset-summary')).toHaveLength(2);
      const historyDir = join(root, '.air', 'runtime', 'methods', 'preset-summary');
      const revisionFile = readdirSync(historyDir).find((name) => name.endsWith('.json'))!;
      const corrupted: MethodVersion = {
        ...version,
        value: { ...summaryPreset.value, id: 'skill-format', name: '', updatedAt: '' },
      };
      writeFileSync(join(historyDir, revisionFile), `${JSON.stringify(corrupted)}\n`);
      expect(() => store.restore(version.id, 'preset-summary')).toThrow('current definition identity');
      expect(store.history('skill-format')).toHaveLength(1);
    } finally {
      fixture.close();
    }
  });
  test('refuses invalid definitions before they reach the vault', () => {
    const fixture = withVaultMethodsStore();
    try {
      const { store } = fixture;
      expect(() => store.save({ kind: 'skill', value: { id: 'bad', name: '', description: '', instructions: '', updatedAt: '' } } as MethodDefinition)).toThrow();
      expect(store.list().length).toBe(0);
    } finally {
      fixture.close();
    }
  });
});
