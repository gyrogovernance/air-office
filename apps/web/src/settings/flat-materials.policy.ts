import { isIntelMacDesktopHost } from '../entry/desktop-host.adapter';
import { PERSONAL_SETTINGS_KEY, readSettingsValues } from './settings.store';

/** Personal preference: solid frost fills instead of translucent glass helpers. */
export const FLAT_MATERIALS_SETTING = 'appearance.flat-materials';
export const FLAT_MATERIALS_CHANGED_EVENT = 'office-flat-materials-changed';

/** Root attribute that mirrors OS reduced-transparency frost rules. */
export const FLAT_MATERIALS_ROOT_ATTR = 'data-reduced-transparency';
export const FLAT_MATERIALS_ROOT_VALUE = 'force';

/** Explicit stored true only. Use effectiveFlatMaterialsEnabled for UI/runtime. */
export function readFlatMaterialsEnabled(value: unknown): boolean {
  return value === true;
}

/**
 * Intel Mac desktop defaults to flat materials (glass off). Apple Silicon,
 * Windows, Linux, and the browser keep glass on until the user turns it off.
 * An explicit true/false preference always wins.
 */
export function defaultFlatMaterialsEnabled(): boolean {
  return isIntelMacDesktopHost();
}

export function effectiveFlatMaterialsEnabled(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return defaultFlatMaterialsEnabled();
}

/** Apply or clear the document root flag that solidifies frost helpers. */
export function applyFlatMaterials(enabled: boolean, root: HTMLElement = document.documentElement): void {
  if (enabled) root.setAttribute(FLAT_MATERIALS_ROOT_ATTR, FLAT_MATERIALS_ROOT_VALUE);
  else root.removeAttribute(FLAT_MATERIALS_ROOT_ATTR);
}

/** Read the stored preference (or Intel-Mac default) and paint the root attribute. */
export function restoreAndApplyFlatMaterials(root: HTMLElement = document.documentElement): boolean {
  const enabled = effectiveFlatMaterialsEnabled(readSettingsValues(PERSONAL_SETTINGS_KEY)[FLAT_MATERIALS_SETTING]);
  applyFlatMaterials(enabled, root);
  return enabled;
}

export function notifyFlatMaterialsChanged(): void {
  window.dispatchEvent(new Event(FLAT_MATERIALS_CHANGED_EVENT));
}
