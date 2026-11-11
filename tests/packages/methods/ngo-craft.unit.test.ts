import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRAFT_PACKAGE_MAX_BYTES, craftComponentId, parseCraftPackage, type MethodDefinition } from '../../../packages/methods/src/methods.domain.public';
import { createSqliteCraftStore, createCraftService } from '../../../packages/methods/src/methods.service.public';
import { loadBundledCompositionCraftPackages, seedBundledCompositionCrafts } from '../../../packages/lab-pack/src/lab-pack.service.public';
import type { AutomationDefinition } from '../../../packages/automations/src/automations.domain.public';

const craftPath = join(import.meta.dir, '../../../packages/lab-pack/data/crafts/ngo-playbook.craft.json');

describe('NGO Playbook craft', () => {
  test('bundled package parses under the size limit with skills, agents, and Actions', () => {
    expect(existsSync(craftPath)).toBe(true);
    const text = readFileSync(craftPath, 'utf8');
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(CRAFT_PACKAGE_MAX_BYTES);
    const craft = parseCraftPackage(text);
    expect(craft.id).toBe('ngo-playbook');
    expect(craft.runtime).toBe('composition');
    expect(craft.description).toContain('NGO');
    expect(craft.description).toContain('SDG');
    expect(craft.methods.filter((item) => item.kind === 'skill')).toHaveLength(5);
    expect(craft.methods.filter((item) => item.kind === 'preset')).toHaveLength(3);
    expect(craft.automations).toHaveLength(5);
    expect(craft.requirements.some((item) => item.key === 'chat-model')).toBe(false);
    expect(craft.requirements.filter((item) => item.kind === 'knowledge').every((item) => item.optional)).toBe(true);
    expect(craft.methods.filter((item) => item.kind === 'preset').every((item) => item.value.model === 'unassigned')).toBe(true);
    expect(craft.methods.some((item) => item.kind === 'skill' && item.value.description.length > 500)).toBe(false);
  });

  test('seeds Disabled and enable materializes craft-prefixed methods and Actions', () => {
    const root = mkdtempSync(join(tmpdir(), 'air-ngo-craft-'));
    const store = createSqliteCraftStore(join(root, 'crafts.sqlite'));
    const methods = new Map<string, MethodDefinition>();
    const automations = new Map<string, AutomationDefinition>();
    try {
      seedBundledCompositionCrafts(store);
      const seeded = store.list().find((item) => item.package.id === 'ngo-playbook');
      expect(seeded?.enabled).toBe(false);

      const craft = loadBundledCompositionCraftPackages().find((item) => item.id === 'ngo-playbook')!;
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
          save: (value) => { automations.set(value.id, value); return value; },
          remove: (id) => { automations.delete(id); },
        },
        action: () => null,
        resources: () => [],
        validateAutomation: () => undefined,
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
      expect([...methods.values()].filter((item) => item.kind === 'skill' && item.value.id.startsWith('craft:ngo-playbook:'))).toHaveLength(5);
      expect([...methods.values()].filter((item) => item.kind === 'preset' && item.value.id.startsWith('craft:ngo-playbook:'))).toHaveLength(3);
      const craftAutomations = [...automations.values()].filter((item) => item.id.startsWith('craft:ngo-playbook:'));
      expect(craftAutomations).toHaveLength(5);
      expect(craftAutomations.every((item) => item.enabled === false)).toBe(true);
      const assistant = methods.get(craftComponentId(craft.id, 'program-design-assistant'));
      expect(assistant?.kind === 'preset' && assistant.value.model).toBe('unassigned');
      expect(methods.has(craftComponentId(craft.id, 'program-design-assistant'))).toBe(true);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('NGO Knowledge references', () => {
  test('optional NGO and companion collections are listed and not install-by-default', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, '../../../packages/lab-pack/data/frameworks-v1.json'), 'utf8')) as {
      collections: Array<{ id: string; install_by_default?: boolean; files: unknown[] }>;
    };
    const ids = [
      'ngo-playbook-guides',
      'ngo-sdg-national-context',
      'oecd-dac-evaluation',
      'un-sdg-indicator-framework',
      'undp-dpi-approach',
    ];
    for (const id of ids) {
      const collection = manifest.collections.find((item) => item.id === id);
      expect(collection).toBeTruthy();
      expect(collection?.install_by_default).toBe(false);
      expect(collection?.files.length).toBeGreaterThan(0);
    }
  });
});
