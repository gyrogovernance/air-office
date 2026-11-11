import { describe, expect, test } from 'bun:test';
import {
  attachmentRejection,
  chatDraftKey,
  chatSettingsKey,
  chatToolIdsKey,
  clearChatDraftIfMatches,
  combineQueueTexts,
  effectiveToolIds,
  imageBlockMessage,
  inheritedChatSettings,
  MAX_CHAT_ATTACHMENT_BYTES,
  modelAcceptsImages,
  parseBoundedNumber,
  parseModelKey,
  readChatDraft,
  readChatSettings,
  readChatToolIds,
  reasoningEffortLabel,
  reasoningOptionsForModel,
  resolveChatSettings,
  selectableTools,
  toMessageAttachments,
  withModelOverride,
  withReasoningEffortForModel,
  writeChatDraft,
  writeChatSettings,
  writeChatToolIds,
  type ChatComposerSettings,
  type DraftStorage,
  type InheritedChatSettings
} from '../../../../apps/web/src/chat/composer.policy';

function fakeStorage(): DraftStorage & { record: Map<string, string> } {
  const record = new Map<string, string>();
  return {
    record,
    getItem: (key) => record.get(key) ?? null,
    setItem: (key, value) => { record.set(key, value); },
    removeItem: (key) => { record.delete(key); }
  };
}

const INHERITED: InheritedChatSettings = { modelKey: 'local-replay:local-replay', model: 'local-replay', provider: 'local-replay', temperature: 0.7, fromAgent: false };

describe('per-chat drafts', () => {
  test('stores, restores and clears a draft under its conversation id', () => {
    const storage = fakeStorage();
    writeChatDraft(storage, 'conv-a', 'question for A');
    writeChatDraft(storage, 'conv-b', 'question for B');
    expect(storage.record.has(chatDraftKey('conv-a'))).toBe(true);
    expect(readChatDraft(storage, 'conv-a')).toBe('question for A');
    expect(readChatDraft(storage, 'conv-b')).toBe('question for B');
    expect(readChatDraft(storage, 'conv-c')).toBe('');
    clearChatDraftIfMatches(storage, 'conv-a', 'question for A');
    expect(readChatDraft(storage, 'conv-a')).toBe('');
    expect(readChatDraft(storage, 'conv-b')).toBe('question for B');
  });

  test('an empty draft removes the record and a missing conversation reads as empty', () => {
    const storage = fakeStorage();
    writeChatDraft(storage, 'conv-a', 'typed');
    writeChatDraft(storage, 'conv-a', '');
    expect(storage.record.size).toBe(0);
    expect(readChatDraft(storage, null)).toBe('');
    expect(readChatDraft(null, 'conv-a')).toBe('');
  });

  test('a malformed stored draft reads as empty without being deleted', () => {
    const storage = fakeStorage();
    storage.record.set(chatDraftKey('conv-a'), '{not json');
    expect(readChatDraft(storage, 'conv-a')).toBe('');
    expect(storage.record.has(chatDraftKey('conv-a'))).toBe(true);
    storage.record.set(chatDraftKey('conv-a'), JSON.stringify({ text: 42 }));
    expect(readChatDraft(storage, 'conv-a')).toBe('');
  });

  test('a clear only fires while the stored text is still the text that was sent', () => {
    const storage = fakeStorage();
    writeChatDraft(storage, 'conv-a', 'old text');
    expect(clearChatDraftIfMatches(storage, 'conv-a', 'different')).toBe(false);
    expect(readChatDraft(storage, 'conv-a')).toBe('old text');
    expect(clearChatDraftIfMatches(storage, 'conv-a', 'old text')).toBe(true);
    expect(readChatDraft(storage, 'conv-a')).toBe('');
  });
});

describe('per-chat settings precedence', () => {
  test('an override wins per key and everything else inherits', () => {
    const perChat: ChatComposerSettings = { temperature: 1.2 };
    const resolved = resolveChatSettings(INHERITED, perChat);
    expect(resolved.model).toBe('local-replay');
    expect(resolved.settings).toEqual({ temperature: 1.2 });
    expect(resolved.sources).toEqual({ model: 'inherited', temperature: 'per-chat', maxOutputTokens: 'inherited', reasoningEffort: 'inherited' });
  });

  test('reasoning effort overrides travel with the run settings and snap to a model default', () => {
    const resolved = resolveChatSettings(INHERITED, { reasoningEffort: 'high' });
    expect(resolved.settings).toEqual({ temperature: 0.7, reasoningEffort: 'high' });
    expect(resolved.sources.reasoningEffort).toBe('per-chat');
    const options = { levels: ['low', 'medium', 'high'] as const, defaultLevel: 'medium' as const };
    expect(withReasoningEffortForModel({ reasoningEffort: 'max' }, options)).toEqual({ reasoningEffort: 'medium' });
    expect(withReasoningEffortForModel({ reasoningEffort: 'high' }, options)).toEqual({ reasoningEffort: 'high' });
    expect(withReasoningEffortForModel({ reasoningEffort: 'high' }, null)).toEqual({});
    expect(reasoningOptionsForModel({ providers: [{ id: 'chatgpt-signin', reasoningByModel: { 'gpt-6.1-sol': options } }] }, 'chatgpt-signin:gpt-6.1-sol')).toEqual(options);
    expect(reasoningEffortLabel('xhigh')).toBe('XHigh');
  });

  test('a model override carries its provider and reports itself', () => {
    const resolved = resolveChatSettings(INHERITED, { modelKey: 'openai:gpt-4o' });
    expect(resolved.model).toBe('gpt-4o');
    expect(resolved.provider).toBe('openai');
    expect(resolved.modelKey).toBe('openai:gpt-4o');
    expect(resolved.sources.model).toBe('per-chat');
    expect(resolved.sources.temperature).toBe('inherited');
  });

  test('picking the inherited model clears the override instead of recording it', () => {
    const first = withModelOverride({}, 'openai:gpt-4o', INHERITED);
    expect(first.modelKey).toBe('openai:gpt-4o');
    // After a model switch, inherited must be the *new* catalog key (not a stale prior selection).
    const switchedInherited = { modelKey: 'managed-local:Bonsai-1.7B-gguf', model: 'Bonsai-1.7B-gguf', provider: 'managed-local', fromAgent: false };
    const afterSwitch = withModelOverride(first, switchedInherited.modelKey, switchedInherited);
    expect(afterSwitch.modelKey).toBeUndefined();
    expect(resolveChatSettings(switchedInherited, afterSwitch)).toMatchObject({ provider: 'managed-local', model: 'Bonsai-1.7B-gguf' });
    const cleared = withModelOverride(first, INHERITED.modelKey, INHERITED);
    expect(cleared.modelKey).toBeUndefined();
    expect(resolveChatSettings(INHERITED, cleared).sources.model).toBe('inherited');
    const untouched = withModelOverride({}, INHERITED.modelKey, INHERITED);
    expect(untouched).toEqual({});
  });

  test('a stored override record survives a roundtrip and out-of-range values drop out', () => {
    const storage = fakeStorage();
    writeChatSettings(storage, 'conv-a', { modelKey: 'openai:gpt-4o', temperature: 1.5, maxOutputTokens: 4096 });
    expect(readChatSettings(storage, 'conv-a')).toEqual({ modelKey: 'openai:gpt-4o', temperature: 1.5, maxOutputTokens: 4096 });
    expect(storage.record.has(chatSettingsKey('conv-a'))).toBe(true);
    storage.record.set(chatSettingsKey('conv-b'), JSON.stringify({ temperature: 9, maxOutputTokens: 0, modelKey: '' }));
    expect(readChatSettings(storage, 'conv-b')).toEqual({});
    storage.record.set(chatSettingsKey('conv-c'), 'broken');
    expect(readChatSettings(storage, 'conv-c')).toEqual({});
    writeChatSettings(storage, 'conv-a', {});
    expect(storage.record.has(chatSettingsKey('conv-a'))).toBe(false);
  });

  test('draft chat settings use the draft key and migrate onto a new conversation id', () => {
    const storage = fakeStorage();
    writeChatSettings(storage, null, { modelKey: 'managed-local:Llama' });
    expect(chatSettingsKey(null)).toBe('air-office:chat-settings:draft');
    expect(readChatSettings(storage, null)).toEqual({ modelKey: 'managed-local:Llama' });
    const draft = readChatSettings(storage, null);
    writeChatSettings(storage, 'new-chat', draft);
    storage.removeItem(chatSettingsKey(null));
    expect(readChatSettings(storage, 'new-chat')).toEqual({ modelKey: 'managed-local:Llama' });
    expect(readChatSettings(storage, null)).toEqual({});
  });

  test('a bounded field accepts contract values and explains the rest', () => {
    expect(parseBoundedNumber('', 0, 2, false)).toEqual({ value: undefined, error: null });
    expect(parseBoundedNumber('0.7', 0, 2, false)).toEqual({ value: 0.7, error: null });
    expect(parseBoundedNumber('2.5', 0, 2, false).value).toBeUndefined();
    expect(parseBoundedNumber('2.5', 0, 2, false).error).toContain('between 0 and 2');
    expect(parseBoundedNumber('abc', 0, 2, false).error).toContain('Enter a number');
    expect(parseBoundedNumber('1024.5', 1, 8192, true).error).toContain('whole number');
    expect(parseBoundedNumber('4096', 1, 8192, true)).toEqual({ value: 4096, error: null });
  });

  test('a model selection key splits into request model and provider', () => {
    expect(parseModelKey('openai:gpt-4o')).toEqual({ model: 'gpt-4o', provider: 'openai' });
    expect(parseModelKey('local-replay')).toEqual({ model: 'local-replay' });
    expect(parseModelKey('provider:')).toEqual({ model: 'provider:' });
  });
});

describe('inherited settings source', () => {
  test('an attached agent supplies the inherited parameters over the workspace selection', () => {
    const inherited = inheritedChatSettings(
      { provider: 'openai', model: 'gpt-4o', settings: { temperature: 0.4, maxOutputTokens: 2048 } },
      { provider: 'local-replay', model: 'local-replay' }
    );
    expect(inherited.modelKey).toBe('openai:gpt-4o');
    expect(inherited.temperature).toBe(0.4);
    expect(inherited.maxOutputTokens).toBe(2048);
    expect(inherited.fromAgent).toBe(true);
  });

  test('without an agent the workspace selection inherits and keeps its provider', () => {
    const inherited = inheritedChatSettings(null, { provider: 'local-replay', model: 'local-replay' });
    expect(inherited.modelKey).toBe('local-replay:local-replay');
    expect(inherited.provider).toBe('local-replay');
    expect(inherited.temperature).toBeUndefined();
    expect(inherited.fromAgent).toBe(false);
    expect(inheritedChatSettings(null, { provider: null, model: null }).modelKey).toBe('');
  });
});

describe('attachment policy', () => {
  test('stored attachments keep identity, label and content type as the version', () => {
    const stored = toMessageAttachments([
      { id: 'a1', type: 'file', name: 'report.pdf', contentType: 'application/pdf' },
      { id: 'a2', type: 'image', name: 'shot.png' }
    ]);
    expect(stored).toEqual([
      { id: 'a1', kind: 'file', label: 'report.pdf', version: 'application/pdf' },
      { id: 'a2', kind: 'file', label: 'shot.png' }
    ]);
  });

  test('empty and oversized files are rejected with the reason and the disclosed limit', () => {
    expect(attachmentRejection({ name: 'empty.txt', size: 0 })).toContain('empty');
    const oversized = attachmentRejection({ name: 'big.bin', size: MAX_CHAT_ATTACHMENT_BYTES + 1 });
    expect(oversized).toContain('10 MB');
    expect(attachmentRejection({ name: 'ok.txt', size: 12 })).toBeNull();
  });
});

describe('per-chat tool picker (CHAT-062/063/065)', () => {
  test('only enabled tools are selectable', () => {
    const catalog = [
      { id: 'builtin:run-code', name: 'Run code', description: 'Executes snippets', enabled: true },
      { id: 'builtin:memory', name: 'Memory', description: 'Recall facts', enabled: true },
      { id: 'remote:legacy', name: 'Legacy', description: 'Off connection', enabled: false }
    ];
    expect(selectableTools(catalog).map((tool) => tool.id)).toEqual(['builtin:run-code', 'builtin:memory']);
  });

  test('selection round-trips per conversation and preserves an explicit empty choice', () => {
    const storage = fakeStorage();
    expect(readChatToolIds(storage, 'c1')).toBeNull();
    writeChatToolIds(storage, 'c1', ['builtin:run-code', 'builtin:memory']);
    expect(readChatToolIds(storage, 'c1')).toEqual(['builtin:run-code', 'builtin:memory']);
    expect(readChatToolIds(storage, 'c2')).toBeNull();
    writeChatToolIds(storage, 'c1', ['builtin:run-code', 'builtin:run-code']);
    expect(readChatToolIds(storage, 'c1')).toEqual(['builtin:run-code']);
    writeChatToolIds(storage, 'c1', []);
    expect(readChatToolIds(storage, 'c1')).toEqual([]);
    expect(storage.record.has(chatToolIdsKey('c1'))).toBe(true);
  });

  test('a corrupt stored selection falls back to inherited workspace defaults', () => {
    const storage = fakeStorage();
    storage.record.set(chatToolIdsKey('c1'), '{not json');
    expect(readChatToolIds(storage, 'c1')).toBeNull();
    storage.record.set(chatToolIdsKey('c2'), '["ok", 3, ""]');
    expect(readChatToolIds(storage, 'c2')).toEqual(['ok']);
  });

  test('stored chat tool ids are returned as plain strings for the live catalog to filter', () => {
    const storage = fakeStorage();
    storage.record.set(chatToolIdsKey('c1'), JSON.stringify(['builtin:memory-search', 'builtin:web-search', 3, '']));
    expect(readChatToolIds(storage, 'c1')).toEqual(['builtin:memory-search', 'builtin:web-search']);
  });

  test('agent tools ride along and the chat selection adds to them (CHAT-063)', () => {
    expect(effectiveToolIds(['chat-tool'], ['agent-tool'])).toEqual(['agent-tool', 'chat-tool']);
    expect(effectiveToolIds(['shared'], ['shared', 'agent'])).toEqual(['shared', 'agent']);
    expect(effectiveToolIds(['only-chat'], [])).toEqual(['only-chat']);
  });
});

describe('model image capability (CHAT-045)', () => {
  const catalog = { providers: [{ id: 'openai', images: true }, { id: 'local-replay', images: false }] };

  test('reports which providers accept images', () => {
    expect(modelAcceptsImages(catalog, 'openai:gpt-4o')).toBe(true);
    expect(modelAcceptsImages(catalog, 'local-replay:local-replay')).toBe(false);
    expect(modelAcceptsImages({ providers: [] }, 'openai:gpt-4o')).toBe(false);
  });

  test('the block message names the model and the recovery path', () => {
    expect(imageBlockMessage('local-replay · local-replay', 'openai · gpt-4o')).toContain('local-replay · local-replay does not accept images');
    expect(imageBlockMessage('local-replay · local-replay', 'openai · gpt-4o')).toContain('Switch to openai · gpt-4o');
    expect(imageBlockMessage('', undefined)).toContain('This model does not accept images');
  });
});

describe('queue combining (CHAT-081)', () => {
  test('several queued messages combine into one turn', () => {
    expect(combineQueueTexts([])).toBe('');
    expect(combineQueueTexts(['first'])).toBe('first');
    expect(combineQueueTexts(['first', '', 'second'])).toBe('first\n\nsecond');
  });

  test('blank entries drop and whitespace trims', () => {
    expect(combineQueueTexts(['  a  ', '   ', 'b'])).toBe('a\n\nb');
  });
});
