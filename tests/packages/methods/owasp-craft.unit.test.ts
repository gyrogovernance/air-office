import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRAFT_PACKAGE_MAX_BYTES, craftComponentId, isAiSafetySkill, parseCraftPackage, type MethodDefinition } from '../../../packages/methods/src/methods.domain.public';
import { createSqliteCraftStore, createCraftService } from '../../../packages/methods/src/methods.service.public';
import { loadBundledCompositionCraftPackages, seedBundledCompositionCrafts } from '../../../packages/lab-pack/src/lab-pack.service.public';
import type { AutomationDefinition } from '../../../packages/automations/src/automations.domain.public';

const craftPath = join(import.meta.dir, '../../../packages/lab-pack/data/crafts/owasp-secure-agent-playbook.craft.json');

describe('OWASP Secure Agent Playbook craft', () => {
  test('bundled package parses under the size limit with the full method and action set', () => {
    expect(existsSync(craftPath)).toBe(true);
    const text = readFileSync(craftPath, 'utf8');
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(CRAFT_PACKAGE_MAX_BYTES);
    const craft = parseCraftPackage(text);
    expect(craft.id).toBe('owasp-secure-agent-playbook');
    expect(craft.runtime).toBe('composition');
    expect(craft.description).toContain('Open Worldwide Application Security Project');
    expect(craft.description).toContain('Secure Agent Playbook');
    expect(craft.description).not.toMatch(/^(Run|Apply|Carry)\b/);
    expect(craft.requirements).toEqual([]);
    expect(craft.methods.filter((item) => item.kind === 'skill')).toHaveLength(18);
    expect(craft.methods.filter((item) => item.kind === 'preset')).toHaveLength(6);
    expect(craft.automations).toHaveLength(17);
    expect(craft.automations.every((item) => item.recurrence.frequency === 'once' && item.recurrence.startDate.startsWith('2099'))).toBe(true);
    const assessor = craft.methods.find((item) => item.kind === 'preset' && item.value.id === 'ai-security-assessor');
    expect(assessor?.kind === 'preset' && assessor.value.skillIds).toHaveLength(7);
    expect(assessor?.kind === 'preset' && assessor.value.model).toBe('unassigned');
    expect(craft.automations.every((item) => item.steps.every((step) => step.kind !== 'action' || step.model === 'unassigned'))).toBe(true);
    expect(craft.methods.some((item) => item.kind === 'skill' && item.value.description.length > 500)).toBe(false);
    expect(isAiSafetySkill({ id: 'x', name: 'Audit', description: '', instructions: 'Library: OWASP Secure Agent Playbook\nCategory: AI security\n' })).toBe(true);
  });

  test('seeds Disabled and enable materializes craft-prefixed methods and Actions without auto-installing Knowledge', () => {
    const root = mkdtempSync(join(tmpdir(), 'air-owasp-craft-'));
    const store = createSqliteCraftStore(join(root, 'crafts.sqlite'));
    const methods = new Map<string, MethodDefinition>();
    const automations = new Map<string, AutomationDefinition>();
    try {
      seedBundledCompositionCrafts(store);
      const seeded = store.list().find((item) => item.package.id === 'owasp-secure-agent-playbook');
      expect(seeded?.enabled).toBe(false);
      expect(methods.size).toBe(0);

      const craft = loadBundledCompositionCraftPackages().find((item) => item.id === 'owasp-secure-agent-playbook')!;
      expect(craft).toBeTruthy();
      const service = createCraftService({
        store,
        methods: {
          list: () => [...methods.values()],
          get: (id) => methods.get(id) ?? null,
          save: (value) => { methods.set(value.value.id, value); return value; },
          remove: (id) => { methods.delete(id); },
        },
        automations: {
          list: () => [...automations.values()],
          save: (value) => {
            if (!value.path) throw new Error('Invalid automation.');
            automations.set(value.id, value);
            return value;
          },
          remove: (id) => { automations.delete(id); },
        },
        action: () => null,
        resources: () => [],
        validateAutomation: (definition) => {
          for (const step of definition.steps) {
            if (step.kind === 'action' && step.providerId !== 'unassigned' && step.modelId !== 'unassigned') {
              throw new Error('Choose an available model.');
            }
          }
        },
        memoryEnabled: () => false,
        setMemoryEnabled: () => undefined,
        hasHumanMarkSkill: () => false,
        humanMarkEnabled: () => false,
        bundledCompositionCrafts: loadBundledCompositionCraftPackages,
      });

      expect(() => service.execute({ action: 'remove', id: craft.id })).toThrow(/disabled but not removed/i);

      const enabled = service.execute({
        action: 'configure',
        id: craft.id,
        enabled: true,
        bindings: {},
        confirmed: true,
      }) as { enabled: boolean };
      expect(enabled.enabled).toBe(true);
      expect([...methods.values()].filter((item) => item.kind === 'skill' && item.value.id.startsWith('craft:owasp-secure-agent-playbook:'))).toHaveLength(18);
      expect([...methods.values()].filter((item) => item.kind === 'preset' && item.value.id.startsWith('craft:owasp-secure-agent-playbook:'))).toHaveLength(6);
      const craftAutomations = [...automations.values()].filter((item) => item.id.startsWith('craft:owasp-secure-agent-playbook:'));
      expect(craftAutomations).toHaveLength(17);
      expect(craftAutomations.every((item) => item.enabled === false)).toBe(true);
      const assessor = methods.get(craftComponentId(craft.id, 'ai-security-assessor'));
      expect(assessor?.kind === 'preset' && assessor.value.model).toBe('unassigned');
      expect(methods.has(craftComponentId(craft.id, 'ai-security-assessor'))).toBe(true);
      expect(store.list().find((item) => item.package.id === craft.id)?.enabled).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('OWASP Knowledge references', () => {
  test('optional OWASP collections are listed and not install-by-default', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '../../../packages/lab-pack/data/frameworks-v1.json'), 'utf8')) as {
      collections: Array<{ id: string; install_by_default?: boolean; files: unknown[] }>;
    };
    const owasp = manifest.collections.filter((item) => item.id.startsWith('owasp-'));
    expect(owasp.map((item) => item.id).sort()).toEqual([
      'owasp-agent-security-plays',
      'owasp-aisvs',
      'owasp-asvs',
      'owasp-code-security-plays',
      'owasp-fiasse',
      'owasp-llm-top10',
      'owasp-mastg',
      'owasp-masvs',
      'owasp-opencre',
      'owasp-secure-code-prompts',
    ]);
    expect(owasp.every((item) => item.install_by_default === false)).toBe(true);
    for (const id of [
      'owasp-aisvs',
      'owasp-llm-top10',
      'owasp-opencre',
      'owasp-asvs',
      'owasp-fiasse',
      'owasp-masvs',
      'owasp-secure-code-prompts',
      'owasp-mastg',
    ]) {
      expect(owasp.find((item) => item.id === id)?.files.length).toBe(1);
    }
    expect(owasp.find((item) => item.id === 'owasp-agent-security-plays')?.files.length).toBeGreaterThan(1);
    expect(owasp.find((item) => item.id === 'owasp-code-security-plays')?.files.length).toBeGreaterThan(1);
  });
});
