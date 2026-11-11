import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { assertNoUnknownKeys, parseFrontmatter, serializeFrontmatter } from '@office/vault/frontmatter';
import { atomicWriteText } from '@office/vault/atomic';
import { ensureVaultLayout, vaultPaths } from '@office/vault/service';
import { actionRelative, packActionRelative, slugify } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot, toVaultRelative } from '@office/vault/host';
import {
  DEFAULT_APP_ICONS,
  GADGET_AGENT_SYSTEM,
  gadgetSystemPrompt,
  metaEvaluationReferenceFile,
  parseLabAppOverride,
  type LabAppOverride,
  type LabGadget,
} from './lab-pack.domain.public';

const ACTION_KEYS = ['name', 'description', 'prompts', 'icon', 'custom'] as const;

export type VaultActionDocument = LabAppOverride & { custom: boolean; slug: string; path: string };

export type VaultLabAppDescriptor = {
  id: string;
  name: string;
  description: string;
  prompts: string[];
  system: string;
  runPrompts: string[];
  edited: boolean;
  icon: string;
  custom: boolean;
  path: string;
};

function isCommentOnlyBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed === '' || trimmed.startsWith('<!--');
}

export function parseActionMarkdown(raw: string, options: { slug: string; path: string; requireCustom?: boolean }): VaultActionDocument {
  const doc = parseFrontmatter(raw);
  assertNoUnknownKeys(doc.data, [...ACTION_KEYS]);
  if (!isCommentOnlyBody(doc.body)) throw new Error(`Action body must be empty or an HTML comment: ${options.path}`);
  const override = parseLabAppOverride({
    name: doc.data.name,
    description: doc.data.description,
    prompts: doc.data.prompts,
    ...(doc.data.icon !== undefined ? { icon: doc.data.icon } : {}),
  });
  if (typeof doc.data.custom !== 'undefined' && typeof doc.data.custom !== 'boolean') {
    throw new Error(`Action custom flag must be boolean: ${options.path}`);
  }
  const custom = doc.data.custom === undefined ? true : doc.data.custom === true;
  if (options.requireCustom === true && custom !== true) throw new Error(`Custom actions tree requires custom: true (${options.path}).`);
  if (options.requireCustom === false && custom !== false) throw new Error(`Pack actions require custom: false (${options.path}).`);
  return { ...override, custom, slug: options.slug, path: options.path };
}

export function serializeActionMarkdown(input: LabAppOverride & { custom?: boolean }): string {
  const data: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    prompts: input.prompts,
  };
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.custom === false) data.custom = false;
  return serializeFrontmatter(data, '');
}

function slugFromFile(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function listActionFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith('.md')).sort();
}

export function readVaultActions(root = resolveVaultRoot()): VaultActionDocument[] {
  ensureVaultLayout(root);
  const paths = vaultPaths(root);
  const actions: VaultActionDocument[] = [];
  for (const name of listActionFiles(paths.packActions)) {
    const absolute = join(paths.packActions, name);
    const relative = toVaultRelative(root, absolute);
    actions.push(parseActionMarkdown(readFileSync(absolute, 'utf8'), { slug: slugFromFile(name), path: relative, requireCustom: false }));
  }
  for (const name of listActionFiles(paths.actions)) {
    const absolute = join(paths.actions, name);
    const relative = toVaultRelative(root, absolute);
    actions.push(parseActionMarkdown(readFileSync(absolute, 'utf8'), { slug: slugFromFile(name), path: relative, requireCustom: true }));
  }
  return actions;
}

export function readVaultActionByPath(root: string, relativePath: string): VaultActionDocument {
  const absolute = resolveUnderVault(root, relativePath);
  if (!existsSync(absolute)) throw new Error(`Unknown Action path: ${relativePath}`);
  const normalized = relativePath.replace(/\\/g, '/');
  const underPack = normalized.startsWith('.air/pack/actions/');
  const underCustom = normalized.startsWith('actions/');
  if (!underPack && !underCustom) throw new Error(`Action path must be under actions/ or .air/pack/actions/: ${relativePath}`);
  return parseActionMarkdown(readFileSync(absolute, 'utf8'), {
    slug: slugFromFile(basename(absolute)),
    path: normalized,
    requireCustom: underCustom ? true : false,
  });
}

export function writeCustomVaultAction(root: string, slug: string, override: LabAppOverride): VaultActionDocument {
  ensureVaultLayout(root);
  const relative = actionRelative(slug);
  const absolute = resolveUnderVault(root, relative);
  atomicWriteText(absolute, serializeActionMarkdown({ ...override, custom: true }));
  return readVaultActionByPath(root, relative);
}

export function removeCustomVaultAction(root: string, slug: string): boolean {
  const absolute = resolveUnderVault(root, actionRelative(slug));
  if (!existsSync(absolute)) return false;
  unlinkSync(absolute);
  return true;
}

export function forkPackActionToCustom(root: string, packSlug: string, customSlug = packSlug): VaultActionDocument {
  const pack = readVaultActionByPath(root, packActionRelative(packSlug));
  return writeCustomVaultAction(root, customSlug, {
    name: pack.name,
    description: pack.description,
    prompts: pack.prompts,
    ...(pack.icon ? { icon: pack.icon } : {}),
  });
}

/** Seed bundled Lab Actions into `.air/pack/actions/` when missing. */
export function ensurePackActionsSeeded(root: string, gadgets: readonly LabGadget[]): void {
  ensureVaultLayout(root);
  for (const gadget of gadgets) {
    const relative = packActionRelative(gadget.id);
    const absolute = resolveUnderVault(root, relative);
    if (existsSync(absolute)) continue;
    atomicWriteText(absolute, serializeActionMarkdown({
      name: gadget.name,
      description: gadget.description,
      prompts: gadget.prompts,
      icon: DEFAULT_APP_ICONS[gadget.id] ?? '✨',
      custom: false,
    }));
  }
}

export function toVaultLabAppDescriptor(
  action: VaultActionDocument,
  resolveReference?: (filename: string) => string,
): VaultLabAppDescriptor {
  const runPrompts = action.prompts.map((base, index) => {
    if (action.slug !== 'meta-evaluation' || action.custom || !resolveReference) return base;
    const filename = metaEvaluationReferenceFile(index);
    if (!filename) return base;
    return `${base}\n\nReference document:\n${resolveReference(filename)}`;
  });
  return {
    id: action.slug,
    name: action.name,
    description: action.description,
    prompts: action.prompts,
    runPrompts,
    system: action.custom ? GADGET_AGENT_SYSTEM : gadgetSystemPrompt(action.slug),
    edited: action.custom,
    icon: action.icon ?? DEFAULT_APP_ICONS[action.slug] ?? '✨',
    custom: action.custom,
    path: action.path,
  };
}

export function loadVaultLabApps(
  root: string,
  gadgets: readonly LabGadget[],
  resolveReference?: (filename: string) => string,
): VaultLabAppDescriptor[] {
  ensurePackActionsSeeded(root, gadgets);
  return readVaultActions(root).map((action) => toVaultLabAppDescriptor(action, resolveReference));
}

export function resolveActionPath(root: string, pathOrSlug: string): string {
  const normalized = pathOrSlug.replace(/\\/g, '/');
  if (normalized.includes('/')) return normalized;
  const custom = actionRelative(slugify(normalized));
  if (existsSync(resolveUnderVault(root, custom))) return custom;
  const pack = packActionRelative(slugify(normalized));
  if (existsSync(resolveUnderVault(root, pack))) return pack;
  throw new Error(`Unknown Action path: ${pathOrSlug}`);
}
