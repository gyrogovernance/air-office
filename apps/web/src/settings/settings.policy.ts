import type { MethodDefinition } from '@office/methods/domain';
import type { RetrievalMode } from '@office/contracts/knowledge';
import { AiChat02Icon, AiCloudIcon, AppStoreIcon, BookOpen01Icon, Calendar03Icon, CodeIcon, CpuIcon, DashboardSquare01Icon, DatabaseIcon, LaptopIcon, News01Icon, PlugSocketIcon, SlidersHorizontalIcon, Store01Icon, TextIcon, User02Icon } from '@hugeicons/core-free-icons';

export type SettingsSection =
  | 'dashboard' | 'profile' | 'today' | 'data' | 'references' | 'knowledge' | 'advanced' | 'craft'
  | 'tools' | 'automations' | 'local-ai' | 'cloud-ai' | 'apps' | 'market'
  | MethodDefinition['kind'];

export type SettingsSectionGroup = 'Personal' | 'Office' | 'General';

export interface SettingsSectionEntry {
  id: SettingsSection;
  label: string;
  group: SettingsSectionGroup;
  category?: 'Professional' | 'Material';
  summary: string;
}

export const settingsSections: readonly SettingsSectionEntry[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'Personal', summary: 'Set up AIR Office and reach frequently used settings.' },
  { id: 'profile', label: 'Profile', group: 'Personal', summary: 'Choose the name and photo shown in your workspace.' },
  { id: 'data', label: 'Data', group: 'Personal', summary: 'Manage storage, exports and workspace content.' },
  { id: 'cloud-ai', label: 'Models', group: 'Office', category: 'Material', summary: 'Manage local and cloud models.' },
  { id: 'knowledge', label: 'Knowledge', group: 'Office', category: 'Material', summary: 'Manage knowledge collections and indexing.' },
  { id: 'prompt', label: 'Prompts', group: 'Office', category: 'Material', summary: 'Manage reusable prompts.' },
  { id: 'skill', label: 'Skills', group: 'Office', category: 'Material', summary: 'Manage skills and their sources.' },
  { id: 'tools', label: 'Tools', group: 'Office', category: 'Material', summary: 'Manage tools and connections.' },
  { id: 'today', label: 'Apps', group: 'Office', category: 'Professional', summary: 'Today edition source, model, and related app preferences.' },
  { id: 'preset', label: 'Agents', group: 'Office', category: 'Professional', summary: 'Manage agents and their resources.' },
  { id: 'apps', label: 'Actions', group: 'Office', category: 'Professional', summary: 'Manage actions and schedules.' },
  { id: 'craft', label: 'Crafts', group: 'Office', category: 'Professional', summary: 'Create, import, export, and turn packages on or off.' },
  { id: 'advanced', label: 'Advanced', group: 'General', summary: 'Searchable configuration values with stored and effective values.' },
  { id: 'references', label: 'References', group: 'General', summary: 'Explore the dependencies, acknowledgments and licenses included in AIR Office.' },
];

/** Icon per settings section, shared by the sidebar, the tab row and the stage title bar. */
export const settingsSectionIcons: Record<SettingsSection, typeof LaptopIcon> = {
  craft: CodeIcon,
  dashboard: DashboardSquare01Icon,
  profile: User02Icon,
  today: News01Icon,
  data: DatabaseIcon,
  references: BookOpen01Icon,
  knowledge: DatabaseIcon,
  market: Store01Icon,
  preset: AiChat02Icon,
  prompt: TextIcon,
  skill: CodeIcon,
  apps: AppStoreIcon,
  'local-ai': CpuIcon,
  'cloud-ai': AiCloudIcon,
  tools: PlugSocketIcon,
  automations: Calendar03Icon,
  advanced: SlidersHorizontalIcon,
};

export type SettingsFlagScope = 'personal' | 'instance';
export type SettingsFlagKind = 'boolean' | 'number' | 'integer' | 'enum';
export type SettingsFlagValue = boolean | number | string;

export interface SettingsFlag {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  readonly group: string;
  readonly scope: SettingsFlagScope;
  readonly kind: SettingsFlagKind;
  readonly defaultValue: SettingsFlagValue;
  readonly options?: readonly string[];
  /** Display names for enum options; falls back to a title-cased id. */
  readonly optionLabels?: Readonly<Record<string, string>>;
  readonly min?: number;
  readonly max?: number;
}

const retrievalModes: readonly RetrievalMode[] = ['vector', 'full-text', 'hybrid'];

/** Search regions the built-in engine accepts; 'wt-wt' is worldwide (no country bias). */
export const WEB_SEARCH_REGIONS: readonly { value: string; label: string }[] = [
  { value: 'wt-wt', label: 'Worldwide' },
  { value: 'us-en', label: 'United States' },
  { value: 'uk-en', label: 'United Kingdom' },
  { value: 'ca-en', label: 'Canada' },
  { value: 'au-en', label: 'Australia' },
  { value: 'de-de', label: 'Germany' },
  { value: 'fr-fr', label: 'France' },
  { value: 'es-es', label: 'Spain' },
  { value: 'it-it', label: 'Italy' },
  { value: 'nl-nl', label: 'Netherlands' },
  { value: 'jp-jp', label: 'Japan' },
  { value: 'in-en', label: 'India' },
  { value: 'br-pt', label: 'Brazil' },
  { value: 'ru-ru', label: 'Russia' }
];

export const settingsFlags: readonly SettingsFlag[] = [
  { id: 'chat.temperature', label: 'Temperature', help: 'Sampling temperature for chat runs that have no preset override.', group: 'Chat', scope: 'personal', kind: 'number', defaultValue: 0.7, min: 0, max: 2 },
  { id: 'chat.max-output-tokens', label: 'Maximum output tokens', help: 'Upper bound for the tokens one chat response may generate.', group: 'Chat', scope: 'personal', kind: 'integer', defaultValue: 2048, min: 1 },
  { id: 'chat.slash-commands', label: 'Slash commands', help: 'Type / in chat to attach a skill or insert a prompt by name.', group: 'Chat', scope: 'personal', kind: 'boolean', defaultValue: true },
  { id: 'knowledge.retrieval-mode', label: 'Retrieval mode', help: 'How collection search answers a query.', group: 'Knowledge', scope: 'instance', kind: 'enum', defaultValue: 'full-text', options: retrievalModes },
  { id: 'knowledge.search-limit', label: 'Results per search', help: 'Number of chunks one collection search returns.', group: 'Knowledge', scope: 'instance', kind: 'integer', defaultValue: 10, min: 1, max: 50 },
  { id: 'web-search.timeout', label: 'Search request timeout', help: 'Milliseconds before a search request is abandoned.', group: 'Web search', scope: 'instance', kind: 'integer', defaultValue: 15000, min: 1000, max: 120000 },
  { id: 'web-search.max-concurrent-requests', label: 'Search concurrent requests', help: 'How many search requests may run at once.', group: 'Web search', scope: 'instance', kind: 'integer', defaultValue: 1, min: 1, max: 8 },
  { id: 'web-search.verify-ssl', label: 'Verify SSL certificates', help: 'Turn this off only for a search service with a self-signed certificate.', group: 'Web search', scope: 'instance', kind: 'boolean', defaultValue: true },
  { id: 'web-search.bypass-web-loader', label: 'Bypass web loader', help: 'Skip the search service own fetcher for results it cannot read.', group: 'Web search', scope: 'instance', kind: 'boolean', defaultValue: false },
  { id: 'web-search.trust-proxy-environment', label: 'Trust proxy environment', help: 'Honour proxy environment variables when reaching the search service.', group: 'Web search', scope: 'instance', kind: 'boolean', defaultValue: true },
  { id: 'web-search.region', label: 'Search region', help: 'Which country the built-in search engine favours. Worldwide avoids a country bias.', group: 'Web search', scope: 'instance', kind: 'enum', defaultValue: 'wt-wt', options: WEB_SEARCH_REGIONS.map((region) => region.value), optionLabels: Object.fromEntries(WEB_SEARCH_REGIONS.map((region) => [region.value, region.label])) },
  { id: 'workspace.restore-stage', label: 'Restore open documents', help: 'Reopen the previous documents and panels after a reload.', group: 'Workspace', scope: 'personal', kind: 'boolean', defaultValue: true },
  { id: 'workspace.notice-duration', label: 'Notice duration', help: 'Seconds a status notice stays on screen.', group: 'Workspace', scope: 'personal', kind: 'integer', defaultValue: 4, min: 1, max: 20 },
];

export type FlagParseResult = { ok: true; value: SettingsFlagValue } | { ok: false; reason: string };

/** Validates one candidate value against a flag's kind and bounds. */
export function parseFlagValue(flag: SettingsFlag, value: unknown): FlagParseResult {
  if (flag.kind === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, reason: 'Expected true or false.' };
  if (flag.kind === 'enum') {
    if (typeof value === 'string' && flag.options?.includes(value)) return { ok: true, value };
    return { ok: false, reason: `Expected one of: ${(flag.options ?? []).join(', ')}.` };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'Expected a number.' };
  if (flag.kind === 'integer' && !Number.isSafeInteger(value)) return { ok: false, reason: 'Expected a whole number.' };
  if (flag.min !== undefined && value < flag.min) return { ok: false, reason: `Must be at least ${flag.min}.` };
  if (flag.max !== undefined && value > flag.max) return { ok: false, reason: `Must be at most ${flag.max}.` };
  return { ok: true, value };
}

export type SettingsValueSource = 'personal' | 'instance' | 'default';

export interface SettingsFlagState {
  /** Raw value stored at the flag's own scope; undefined when nothing is stored there. */
  stored: unknown;
  storedSet: boolean;
  storedValid: boolean;
  effective: SettingsFlagValue;
  source: SettingsValueSource;
}

/**
 * Resolves a flag the way the application applies it: a valid personal value
 * wins, then a valid instance default, then the built-in default. An invalid
 * stored value never becomes effective but stays visible for repair or reset.
 */
export function resolveFlagState(
  flag: SettingsFlag,
  personal: Record<string, unknown>,
  instance: Record<string, unknown>,
): SettingsFlagState {
  const personalRaw = personal[flag.id];
  const instanceRaw = instance[flag.id];
  const personalParsed = personalRaw === undefined ? null : parseFlagValue(flag, personalRaw);
  const instanceParsed = instanceRaw === undefined ? null : parseFlagValue(flag, instanceRaw);
  const primaryRaw = flag.scope === 'personal' ? personalRaw : instanceRaw;
  const primaryParsed = flag.scope === 'personal' ? personalParsed : instanceParsed;
  if (personalParsed?.ok) return buildState(primaryRaw, primaryParsed, personalParsed.value, 'personal');
  if (instanceParsed?.ok) return buildState(primaryRaw, primaryParsed, instanceParsed.value, 'instance');
  return buildState(primaryRaw, primaryParsed, flag.defaultValue, 'default');
}

function buildState(
  primaryRaw: unknown,
  primaryParsed: FlagParseResult | null,
  effective: SettingsFlagValue,
  source: SettingsValueSource,
): SettingsFlagState {
  return {
    stored: primaryRaw,
    storedSet: primaryRaw !== undefined,
    storedValid: primaryRaw === undefined || primaryParsed?.ok === true,
    effective,
    source,
  };
}

export function formatFlagValue(flag: SettingsFlag, value: unknown): string {
  if (value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return flag.kind === 'enum' ? flagOptionLabel(flag, value) : value;
  return JSON.stringify(value) ?? String(value);
}

export function flagOptionLabel(flag: SettingsFlag, option: string): string {
  const known = flag.optionLabels?.[option];
  if (known) return known;
  const words = option.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Filters advanced settings by identifier, label, group, or help text. */
export function searchSettingsFlags(query: string, flags: readonly SettingsFlag[] = settingsFlags): SettingsFlag[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...flags];
  return flags.filter((flag) =>
    flag.id.includes(needle)
    || flag.label.toLowerCase().includes(needle)
    || flag.group.toLowerCase().includes(needle)
    || flag.help.toLowerCase().includes(needle));
}
