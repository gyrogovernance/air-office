import { describe, expect, test } from 'bun:test';
import { chatPath, parseChatRoute, restoredConversationId } from '../../../../apps/web/src/chat/chat-routing.policy';

describe('chat deep links', () => {
  test('a conversation link parses to its identifier', () => {
    expect(parseChatRoute('/chat/abc-123')).toEqual({ conversationId: 'abc-123', messageId: null });
    expect(parseChatRoute('/chat/abc-123/m/msg-9')).toEqual({ conversationId: 'abc-123', messageId: 'msg-9' });
    expect(parseChatRoute('/')).toEqual({ conversationId: null, messageId: null });
    expect(parseChatRoute('/settings')).toEqual({ conversationId: null, messageId: null });
  });

  test('a malformed destination never opens a conversation', () => {
    expect(parseChatRoute('/chat/')).toEqual({ conversationId: null, messageId: null });
    expect(parseChatRoute('/chat/../../etc')).toEqual({ conversationId: null, messageId: null });
    expect(parseChatRoute('/chat/abc/m/')).toEqual({ conversationId: 'abc', messageId: null });
    expect(parseChatRoute(`/chat/${'a'.repeat(300)}`)).toEqual({ conversationId: null, messageId: null });
  });

  test('only an address-bar chat is restored when it is still in the service list', () => {
    const summaries = [{ id: 'kept' }];
    expect(restoredConversationId(summaries, 'kept')).toBe('kept');
    expect(restoredConversationId(summaries, null)).toBeNull();
    expect(restoredConversationId(summaries, 'gone')).toBeNull();
    expect(restoredConversationId(null, 'kept')).toBeNull();
  });

  test('a route round-trips through its pathname form', () => {
    expect(chatPath('abc')).toBe('/chat/abc');
    expect(parseChatRoute(chatPath('abc', 'm1')!)).toEqual({ conversationId: 'abc', messageId: 'm1' });
    expect(chatPath(null)).toBeNull();
    expect(chatPath('not a valid id')).toBeNull();
  });
});
