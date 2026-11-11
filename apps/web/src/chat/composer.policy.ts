import type { MessageAttachment } from '@office/chat/domain';
import { isChatReasoningEffort, type ChatReasoningEffort, type ChatRunSettings, type ModelReasoningOptions } from '@office/contracts/chat';

/**
 * Composer state that must survive a conversation switch or a reload without
 * the service owning it: per-chat drafts and per-chat generation overrides.
 * The storage surface is passed in so the policy stays free of renderer
 * globals and every branch here is unit-testable.
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Attachments one message may carry, with the read limits disclosed in the composer. */
export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function chatDraftKey(conversationId: string): string {
  return `air-office:chat-draft:${conversationId}`;
}

export function readChatDraft(storage: DraftStorage | null, conversationId: string | null): string {
  if (!storage || !conversationId) return '';
  try {
    const stored: unknown = JSON.parse(storage.getItem(chatDraftKey(conversationId)) ?? 'null');
    if (stored && typeof stored === 'object') {
      const text = (stored as { text?: unknown }).text;
      if (typeof text === 'string') return text;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Stores the typed text under the conversation id, so reopening or reloading
 * the workspace restores what was never sent. An empty text removes the record
 * and a storage failure keeps the draft in the composer instead of raising,
 * because the visible text is still recoverable from the input itself.
 */
export function writeChatDraft(storage: DraftStorage | null, conversationId: string | null, text: string): void {
  if (!storage || !conversationId) return;
  const key = chatDraftKey(conversationId);
  if (!text) {
    storage.removeItem(key);
    return;
  }
  try {
    storage.setItem(key, JSON.stringify({ text, savedAt: new Date().toISOString() }));
  } catch {
    /* Storage may be full or blocked; the draft stays in the composer. */
  }
}

/**
 * Clears the stored draft once its text has actually been stored or queued, and
 * only when it still holds that text, so a newer draft typed after the send is
 * never deleted by the send that preceded it.
 */
export function clearChatDraftIfMatches(storage: DraftStorage | null, conversationId: string | null, sentText: string): boolean {
  if (!storage || !conversationId) return false;
  if (readChatDraft(storage, conversationId) !== sentText) return false;
  writeChatDraft(storage, conversationId, '');
  return true;
}

/** Per-chat generation overrides. A missing key means the chat inherits. */
export interface ChatComposerSettings {
  modelKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ChatReasoningEffort;
}

/** The settings a chat uses when it carries no override of its own. */
export interface InheritedChatSettings {
  /** Selection key in the composer select vocabulary (`provider:model`). */
  modelKey: string;
  /** Bare model id as the run request carries it. */
  model: string;
  provider?: string;
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ChatReasoningEffort;
  fromAgent: boolean;
}

export type ChatSettingsSource = 'per-chat' | 'inherited';

export interface ResolvedChatSettings {
  modelKey: string;
  model: string;
  provider?: string;
  settings: ChatRunSettings;
  sources: Record<'model' | 'temperature' | 'maxOutputTokens' | 'reasoningEffort', ChatSettingsSource>;
}

const reasoningEffortLabels: Record<ChatReasoningEffort, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max'
};

/** Short labels for the compact composer control. */
export function reasoningEffortLabel(level: ChatReasoningEffort): string {
  return reasoningEffortLabels[level];
}

/** Resolves the selectable reasoning levels for the current model, if any. */
export function reasoningOptionsForModel(
  catalog: { providers: { id: string; reasoningByModel?: Record<string, ModelReasoningOptions> }[] },
  modelKey: string
): ModelReasoningOptions | null {
  const parsed = parseModelKey(modelKey);
  if (!parsed.provider || !parsed.model) return null;
  return catalog.providers.find((provider) => provider.id === parsed.provider)?.reasoningByModel?.[parsed.model] ?? null;
}

export function parseModelKey(key: string): { model: string; provider?: string } {
  const at = key.indexOf(':');
  if (at <= 0) return { model: key };
  const provider = key.slice(0, at);
  const model = key.slice(at + 1);
  if (!model) return { model: key };
  return { model, provider };
}

/**
 * Resolves the settings for one request: every key the chat overrides wins,
 * every key it does not carries the inherited value, and the report of which
 * side won is what the composer renders next to each control.
 */
export function resolveChatSettings(inherited: InheritedChatSettings, perChat: ChatComposerSettings): ResolvedChatSettings {
  const modelOverridden = perChat.modelKey !== undefined && perChat.modelKey !== '' && perChat.modelKey !== inherited.modelKey;
  const modelKey = modelOverridden ? perChat.modelKey! : inherited.modelKey;
  const parsed = modelOverridden ? parseModelKey(perChat.modelKey!) : { model: inherited.model, provider: inherited.provider };
  const temperature = perChat.temperature ?? inherited.temperature;
  const maxOutputTokens = perChat.maxOutputTokens ?? inherited.maxOutputTokens;
  const reasoningEffort = perChat.reasoningEffort ?? inherited.reasoningEffort;
  return {
    modelKey,
    model: parsed.model,
    provider: parsed.provider ?? inherited.provider,
    settings: {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {})
    },
    sources: {
      model: modelOverridden ? 'per-chat' : 'inherited',
      temperature: perChat.temperature !== undefined ? 'per-chat' : 'inherited',
      maxOutputTokens: perChat.maxOutputTokens !== undefined ? 'per-chat' : 'inherited',
      reasoningEffort: perChat.reasoningEffort !== undefined ? 'per-chat' : 'inherited'
    }
  };
}

/** Keeps a stored effort only when the newly selected model still supports it. */
export function withReasoningEffortForModel(settings: ChatComposerSettings, options: ModelReasoningOptions | null): ChatComposerSettings {
  if (!options) {
    if (settings.reasoningEffort === undefined) return settings;
    const { reasoningEffort: _removed, ...rest } = settings;
    return rest;
  }
  if (settings.reasoningEffort && options.levels.includes(settings.reasoningEffort)) return settings;
  return { ...settings, reasoningEffort: options.defaultLevel };
}

/** Sets or clears the model override; picking the inherited value clears it. */
export function withModelOverride(settings: ChatComposerSettings, modelKey: string | undefined, inherited: InheritedChatSettings): ChatComposerSettings {
  if (modelKey === undefined || modelKey === inherited.modelKey) {
    if (settings.modelKey === undefined) return settings;
    const { modelKey: _removed, ...rest } = settings;
    return rest;
  }
  if (settings.modelKey === modelKey) return settings;
  return { ...settings, modelKey };
}

/** Builds the settings a chat inherits: an attached agent wins over the workspace selection, per-chat overrides win over both. */
export function inheritedChatSettings(agent: { provider?: string; model: string; settings: ChatRunSettings } | null, catalog: { provider: string | null; model: string | null }): InheritedChatSettings {
  const provider = agent?.provider || catalog.provider || undefined;
  const model = agent?.model || catalog.model || '';
  const inherited: InheritedChatSettings = {
    modelKey: provider && model ? `${provider}:${model}` : model,
    model,
    fromAgent: agent !== null
  };
  if (provider !== undefined) inherited.provider = provider;
  if (agent?.settings.temperature !== undefined) inherited.temperature = agent.settings.temperature;
  if (agent?.settings.maxOutputTokens !== undefined) inherited.maxOutputTokens = agent.settings.maxOutputTokens;
  if (agent?.settings.reasoningEffort !== undefined) inherited.reasoningEffort = agent.settings.reasoningEffort;
  return inherited;
}

export function chatSettingsKey(conversationId: string | null): string {
  return `air-office:chat-settings:${conversationId ?? 'draft'}`;
}

function boundedNumber(value: unknown, min: number, max: number, integer: boolean): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return undefined;
  if (integer && !Number.isSafeInteger(value)) return undefined;
  return value;
}

/** Reads a per-chat override record, dropping any value that leaves the contract range. Draft chats use the `draft` key (same pattern as tools). */
export function readChatSettings(storage: DraftStorage | null, conversationId: string | null): ChatComposerSettings {
  if (!storage) return {};
  try {
    const stored: unknown = JSON.parse(storage.getItem(chatSettingsKey(conversationId)) ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const record = stored as Record<string, unknown>;
    const modelKey = typeof record.modelKey === 'string' && record.modelKey.trim() ? record.modelKey : undefined;
    const temperature = boundedNumber(record.temperature, 0, 2, false);
    const maxOutputTokens = boundedNumber(record.maxOutputTokens, 1, Number.MAX_SAFE_INTEGER, true);
    const reasoningEffort = isChatReasoningEffort(record.reasoningEffort) ? record.reasoningEffort : undefined;
    const next: ChatComposerSettings = {};
    if (modelKey !== undefined) next.modelKey = modelKey;
    if (temperature !== undefined) next.temperature = temperature;
    if (maxOutputTokens !== undefined) next.maxOutputTokens = maxOutputTokens;
    if (reasoningEffort !== undefined) next.reasoningEffort = reasoningEffort;
    return next;
  } catch {
    return {};
  }
}

export function writeChatSettings(storage: DraftStorage | null, conversationId: string | null, settings: ChatComposerSettings): void {
  if (!storage) return;
  const key = chatSettingsKey(conversationId);
  const clean: ChatComposerSettings = {};
  if (settings.modelKey) clean.modelKey = settings.modelKey;
  if (settings.temperature !== undefined && boundedNumber(settings.temperature, 0, 2, false) !== undefined) clean.temperature = settings.temperature;
  if (settings.maxOutputTokens !== undefined && boundedNumber(settings.maxOutputTokens, 1, Number.MAX_SAFE_INTEGER, true) !== undefined) clean.maxOutputTokens = settings.maxOutputTokens;
  if (settings.reasoningEffort !== undefined && isChatReasoningEffort(settings.reasoningEffort)) clean.reasoningEffort = settings.reasoningEffort;
  if (!Object.keys(clean).length) {
    storage.removeItem(key);
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(clean));
  } catch {
    /* The override stays in renderer state when storage rejects the write. */
  }
}

/** Parses a bounded setting field; an empty input means the chat inherits again. */
export function parseBoundedNumber(raw: string, min: number, max: number, integer: boolean): { value: number | undefined; error: string | null } {
  const text = raw.trim();
  if (!text) return { value: undefined, error: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: undefined, error: `Enter a number between ${min} and ${max}.` };
  if (value < min || value > max) return { value: undefined, error: `Value must be between ${min} and ${max}.` };
  if (integer && !Number.isSafeInteger(value)) return { value: undefined, error: `Enter a whole number of at least ${min}.` };
  return { value, error: null };
}

export interface ComposerAttachmentRef {
  id: string;
  type: string;
  name: string;
  contentType?: string;
}

/**
 * Projects composer attachments onto the stored message reference. The graph
 * carries identity, label and content type rather than file bytes, so what the
 * service keeps matches what the thread renders back on the user message.
 */
export function toMessageAttachments(attachments: readonly ComposerAttachmentRef[]): MessageAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    kind: 'file',
    label: attachment.name || 'Attachment',
    ...(attachment.contentType ? { version: attachment.contentType } : {})
  }));
}

/** Why a file cannot be attached; null means it passes the disclosed limits. */
export function attachmentRejection(file: { name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name || 'This file'} is empty, so there is nothing to attach.`;
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) return `${file.name || 'This file'} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_CHAT_ATTACHMENT_BYTES)}.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Per-chat tool selection (CHAT-062/063/065). The composer lists enabled tools
 * from the service catalog, the chat stores its selection, and the run request
 * carries only those ids. An enabled flag the service has since revoked is
 * dropped at request time by the service, so the stored selection stays honest.
 */
export interface ToolCatalogEntry {
  id: string;
  connectionId?: string;
  name: string;
  description: string;
  enabled: boolean;
  effect?: 'read' | 'mutate';
  connected?: boolean;
}

/** Filters the catalog to the enabled tools a chat may pick. */
export function selectableTools(catalog: ToolCatalogEntry[]): ToolCatalogEntry[] {
  return catalog.filter((tool) => tool.enabled);
}

export function chatToolIdsKey(conversationId: string | null): string {
  return `air-office:chat-tools:${conversationId ?? 'draft'}`;
}

export function readChatToolIds(storage: DraftStorage | null, conversationId: string | null): string[] | null {
  if (!storage) return null;
  try {
    const stored: unknown = JSON.parse(storage.getItem(chatToolIdsKey(conversationId)) ?? 'null');
    if (!Array.isArray(stored)) return null;
    return [...new Set(stored.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  } catch {
    return null;
  }
}

export function writeChatToolIds(storage: DraftStorage | null, conversationId: string | null, toolIds: string[]): void {
  if (!storage) return;
  const key = chatToolIdsKey(conversationId);
  try {
    storage.setItem(key, JSON.stringify([...new Set(toolIds)]));
  } catch {
    /* Selection stays in renderer state when storage rejects the write. */
  }
}

/**
 * Merges a per-chat selection with the tool ids an attached agent carries
 * (CHAT-063). The agent's tools always ride along; the chat's own selection
 * adds to them, so detaching the agent never silently widens the chat.
 */
export function effectiveToolIds(perChat: string[], agentToolIds: string[]): string[] {
  return [...new Set([...agentToolIds, ...perChat])];
}

/**
 * Model image capability check (CHAT-045). The composer knows each provider's
 * image support from the catalog and the selected model key; when the model
 * cannot accept images an attachment attempt reports which model blocks it.
 */
export function modelAcceptsImages(catalog: { providers: { id: string; images?: boolean }[] }, modelKey: string): boolean {
  const providerId = modelKey.split(':')[0] ?? modelKey;
  const provider = catalog.providers.find((item) => item.id === providerId);
  return provider?.images === true;
}

/** Builds the warning the composer shows when images cannot ride this model. */
export function imageBlockMessage(modelLabel: string, fallbackLabel?: string): string {
  const model = modelLabel || 'This model';
  const recover = fallbackLabel ? ` Switch to ${fallbackLabel} to send images.` : ' Switch to a model that accepts images to send them.';
  return `${model} does not accept images.${recover}`;
}

/**
 * Queue combining (CHAT-081). When several messages queue during one response,
 * they send as one combined turn instead of separate runs; a dispatch failure
 * restores the original queue once so nothing is lost.
 */
export function combineQueueTexts(texts: string[]): string {
  const parts = texts.map((text) => text.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return parts.join('\n\n');
}
