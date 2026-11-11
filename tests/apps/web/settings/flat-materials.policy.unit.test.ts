import { describe, expect, test } from 'bun:test';
import {
  FLAT_MATERIALS_ROOT_ATTR,
  FLAT_MATERIALS_ROOT_VALUE,
  applyFlatMaterials,
  effectiveFlatMaterialsEnabled,
  readFlatMaterialsEnabled,
} from '../../../../apps/web/src/settings/flat-materials.policy';

describe('flat-materials.policy', () => {
  test('reads only an explicit true preference', () => {
    expect(readFlatMaterialsEnabled(true)).toBe(true);
    expect(readFlatMaterialsEnabled(false)).toBe(false);
    expect(readFlatMaterialsEnabled(undefined)).toBe(false);
    expect(readFlatMaterialsEnabled('true')).toBe(false);
  });

  test('effective preference keeps explicit true/false and defaults off without a desktop host', () => {
    expect(effectiveFlatMaterialsEnabled(true)).toBe(true);
    expect(effectiveFlatMaterialsEnabled(false)).toBe(false);
    // Unit tests have no airDesktop bridge, so the Intel-Mac default does not apply.
    expect(effectiveFlatMaterialsEnabled(undefined)).toBe(false);
  });

  test('sets and clears the reduced-transparency force attribute', () => {
    const root = { attributes: new Map<string, string>(), setAttribute(name: string, value: string) { this.attributes.set(name, value); }, removeAttribute(name: string) { this.attributes.delete(name); }, getAttribute(name: string) { return this.attributes.get(name) ?? null; } };
    applyFlatMaterials(true, root as unknown as HTMLElement);
    expect(root.getAttribute(FLAT_MATERIALS_ROOT_ATTR)).toBe(FLAT_MATERIALS_ROOT_VALUE);
    applyFlatMaterials(false, root as unknown as HTMLElement);
    expect(root.getAttribute(FLAT_MATERIALS_ROOT_ATTR)).toBeNull();
  });
});
