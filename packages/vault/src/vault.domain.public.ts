export const VAULT_VERSION = 1;
export const VAULT_VERSION_RELATIVE = '.air/settings/vault-version';

export const VAULT_PATHS = {
  programs: 'programs',
  generalProgram: 'programs/general',
  calendar: 'calendar',
  automations: 'automations',
  actions: 'actions',
  packActions: '.air/pack/actions',
  agents: '.air/agents',
  skills: '.air/skills',
  prompts: '.air/prompts',
  settings: '.air/settings',
  trash: '.air/trash',
  runtime: '.air/runtime',
  memoryFacts: 'memory/facts.jsonl',
  memoryEpisodes: 'memory/episodes',
  sources: 'sources',
  workspaceSettings: '.air/settings/workspace.yaml',
  toolsSettings: '.air/settings/tools.yaml',
  webSearchSettings: '.air/settings/web-search.yaml',
  modelHarnessSettings: '.air/settings/model-harness.yaml',
  vaultVersion: VAULT_VERSION_RELATIVE,
} as const;

/** Normalize a vault-relative path to forward slashes without leading slash. */
export function normalizeVaultRelative(path: string): string {
  const trimmed = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('\0') || trimmed.split('/').some((part) => part === '..')) {
    throw new Error(`Invalid vault path: ${path}`);
  }
  return trimmed;
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'untitled';
}

export function programNotesDir(programSlug: string): string {
  return `${VAULT_PATHS.programs}/${slugify(programSlug)}/notes`;
}

export function programChatsDir(programSlug: string): string {
  return `${VAULT_PATHS.programs}/${slugify(programSlug)}/chats`;
}

export function noteJsonRelative(programSlug: string, noteSlug: string): string {
  return `${programNotesDir(programSlug)}/${slugify(noteSlug)}.note.json`;
}

export function noteMarkdownRelative(programSlug: string, noteSlug: string): string {
  return `${programNotesDir(programSlug)}/${slugify(noteSlug)}.md`;
}

export function calendarRelative(listSlug: string): string {
  return `${VAULT_PATHS.calendar}/${slugify(listSlug)}.ics`;
}

export function automationRelative(nameSlug: string): string {
  return `${VAULT_PATHS.automations}/${slugify(nameSlug)}.automation.yaml`;
}

export function actionRelative(slug: string): string {
  return `${VAULT_PATHS.actions}/${slugify(slug)}.md`;
}

export function packActionRelative(slug: string): string {
  return `${VAULT_PATHS.packActions}/${slugify(slug)}.md`;
}

/** Vault-relative chat folder for a conversation under a program. */
export function conversationRelative(programSlug: string, conversationId: string): string {
  return `${programChatsDir(programSlug)}/${conversationId}`;
}

/** Prefer programs/general when the UI has no program context. */
export function defaultConversationPath(conversationId: string): string {
  return conversationRelative('general', conversationId);
}

/** Extract conversation id from `…/chats/<id>` or `…/chats/<id>/…`. */
export function conversationIdFromPath(path: string): string | null {
  const normalized = normalizeVaultRelative(path);
  const match = /(?:^|\/)chats\/([^/]+)(?:\/|$)/.exec(normalized);
  return match?.[1] ?? null;
}

/** Calendar list file path from list id (filename slug matches slugify(id)). */
export function calendarPathForListId(listId: string): string {
  return calendarRelative(listId);
}

/** Basename slug of a calendar .ics path, or null when the path is not a calendar file. */
export function calendarSlugFromPath(path: string): string | null {
  const normalized = normalizeVaultRelative(path);
  const match = /^calendar\/([^/]+)\.ics$/.exec(normalized);
  return match?.[1] ?? null;
}

/** Action slug from `actions/<slug>.md` or `.air/pack/actions/<slug>.md`. */
export function actionSlugFromPath(path: string): string | null {
  const normalized = normalizeVaultRelative(path);
  const match = /(?:^|\/)(?:actions|\.air\/pack\/actions)\/([^/]+)\.md$/.exec(normalized);
  return match?.[1] ?? null;
}

export function sourcesCollectionDir(collectionSlug: string): string {
  return `${VAULT_PATHS.sources}/${slugify(collectionSlug || 'inbox')}`;
}

export function sourcesOriginalRelative(collectionSlug: string, contentHash: string, ext: string): string {
  const clean = ext.replace(/^\./, '');
  return `${sourcesCollectionDir(collectionSlug)}/originals/${contentHash}.${clean}`;
}

export function sourcesMetaRelative(collectionSlug: string, contentHash: string): string {
  return `${sourcesCollectionDir(collectionSlug)}/meta/${contentHash}.yaml`;
}

export function sourcesCollectionYamlRelative(collectionSlug: string): string {
  return `${sourcesCollectionDir(collectionSlug)}/collection.yaml`;
}

export function knowledgeRuntimeRelative(...parts: string[]): string {
  return ['.air/runtime/knowledge', ...parts.map((part) => part.replace(/^\/+|\/+$/g, ''))].filter(Boolean).join('/');
}
