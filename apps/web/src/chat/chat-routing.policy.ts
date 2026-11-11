/** Chat deep links are canonical pathname routes owned by the application router. */

export interface ChatRoute {
  conversationId: string | null;
  messageId: string | null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function parseChatRoute(pathname: string): ChatRoute {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'chat') return { conversationId: null, messageId: null };
  const conversationId = parts[1];
  if (!conversationId || !ID_PATTERN.test(conversationId)) return { conversationId: null, messageId: null };
  if (parts[2] !== 'm') return { conversationId, messageId: null };
  const messageId = parts[3];
  if (!messageId || !ID_PATTERN.test(messageId)) return { conversationId, messageId: null };
  return { conversationId, messageId };
}

/** Opens an address-bar chat only when it is still in the current service list. */
export function restoredConversationId(summaries: { id: string }[] | null, routeId: string | null): string | null {
  const id = routeId;
  if (!id || !summaries?.some((item) => item.id === id)) return null;
  return id;
}

export function chatPath(conversationId: string | null, messageId?: string | null): string | null {
  if (!conversationId) return null;
  if (!ID_PATTERN.test(conversationId)) return null;
  if (!messageId) return `/chat/${conversationId}`;
  if (!ID_PATTERN.test(messageId)) return `/chat/${conversationId}`;
  return `/chat/${conversationId}/m/${messageId}`;
}
