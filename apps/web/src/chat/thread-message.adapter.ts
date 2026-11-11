import type { MessageStatus, ThreadMessageLike } from '@assistant-ui/react';
import type { ConversationGraph, ConversationMessage, MessageAttachment, OutputBlock } from '@office/chat/domain';
import { activeLeaf, messagePath } from '@office/chat/domain';

type ThreadPart = Exclude<ThreadMessageLike['content'], string>[number];
type ToolCallPart = Extract<ThreadPart, { type: 'tool-call' }>;

/**
 * The single boundary between the service conversation graph and the assistant-ui runtime.
 *
 * The service graph is the only state the chat surface reads: branches live in parent
 * references, streaming progress in `statusHistory`, and structured output in `output`.
 * This adapter projects one branch of that graph into the flat message list the runtime
 * renders, so the runtime never holds a second copy of the conversation and a reload
 * cannot disagree with what the service stored.
 */

export const WELCOME_MESSAGE_ID = 'welcome';

const WELCOME: ThreadMessageLike = {
  id: WELCOME_MESSAGE_ID,
  role: 'assistant',
  content: 'I’m the local demo assistant. Open a file and select text to ask for a focused explanation or a proposed rewrite.',
  status: { type: 'complete', reason: 'stop' }
};

/** Structured output the renderer has no dedicated part for keeps its payload as data, so nothing is dropped. */
function unknownBlockPart(block: OutputBlock, index: number): ThreadPart {
  return { type: 'data', id: `block-${index}`, name: 'air-unknown-block', data: block };
}

function blockParts(message: ConversationMessage): ThreadPart[] {
  const blocks = message.role === 'assistant'
    ? [...message.output.filter((block) => block.kind === 'reasoning' || block.kind === 'tool'), ...message.output.filter((block) => block.kind !== 'reasoning' && block.kind !== 'tool')]
    : message.output;
  return blocks.flatMap((block, index): ThreadPart[] => {
    if (block.kind === 'text') return block.text ? [{ type: 'text', id: `text-${index}`, text: block.text }] : [];
    if (block.kind === 'reasoning') {
      if (!block.text && block.status !== 'running') return [];
      const startedAt = block.startedAt ? Date.parse(block.startedAt) : undefined;
      const completedAt = block.completedAt ? Date.parse(block.completedAt) : undefined;
      const partRunning = block.status === 'running' || (!message.complete && Boolean(message.runId) && !block.completedAt);
      return [{
        type: 'reasoning',
        id: `reasoning-${index}`,
        text: block.text ?? '',
        status: partRunning ? { type: 'running' } : { type: 'complete' },
        ...(Number.isFinite(startedAt) ? {
          timing: {
            startedAt: startedAt!,
            ...(Number.isFinite(completedAt) ? { completedAt: completedAt! } : {})
          }
        } : {})
      }];
    }
    if (block.kind === 'image') return block.sourceId ? [{ type: 'file', id: `image-${index}`, filename: block.sourceId, data: block.sourceId, mimeType: block.mimeType ?? 'image/png', sourceType: 'id' }] : [];
    if (block.kind === 'tool') {
      if (!block.toolCallId || !block.name) return [unknownBlockPart(block, index)];
      const settled = block.status === 'ok' || block.status === 'error';
      const running = block.status === 'pending' || block.status === 'running';
      return [{
        type: 'tool-call',
        toolCallId: block.toolCallId,
        toolName: block.name,
        args: (block.arguments ?? {}) as ToolCallPart['args'],
        argsText: JSON.stringify(block.arguments ?? {}),
        // A settled call without a payload still needs a defined result so the
        // row leaves "Working…" (assistant-ui treats missing result as live).
        ...(block.result !== undefined || settled ? { result: block.result ?? null } : {}),
        ...(block.status === 'error' ? { isError: true } : {}),
        ...(running ? { isPreliminary: true } : settled ? { isPreliminary: false } : {})
      }];
    }
    return [unknownBlockPart(block, index)];
  });
}

function messageStatus(message: ConversationMessage): MessageStatus {
  const last = message.statusHistory.at(-1);
  if (message.error) return { type: 'incomplete', reason: 'error', error: { code: message.error.code, message: message.error.message } };
  if (last?.label === 'length') return { type: 'incomplete', reason: 'length' };
  if (last?.label === 'cancelled') return { type: 'incomplete', reason: 'cancelled' };
  if (!message.complete && message.runId) return { type: 'running' };
  return { type: 'complete', reason: 'stop' };
}

function toAttachments(attachments: MessageAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    type: attachment.kind,
    name: attachment.label,
    ...(attachment.version ? { contentType: attachment.version } : {}),
    status: { type: 'complete' as const },
    content: [{ type: 'text' as const, text: attachment.label }]
  }));
}

/** Projects one graph message, keeping the graph id so deep links and branch operations address the stored row. */
export function toThreadMessage(message: ConversationMessage): ThreadMessageLike {
  const parts = blockParts(message);
  const isUser = message.role === 'user';
  return {
    id: message.id,
    role: isUser ? 'user' : message.role,
    content: parts.length ? parts : [{ type: 'text', text: message.content }],
    createdAt: new Date(message.createdAt),
    // The runtime owns status and attachments on user messages, so only assistant
    // and system messages carry them; user-side files stay in metadata instead.
    ...(isUser ? {} : { status: messageStatus(message) }),
    ...(message.attachments.length && isUser ? { attachments: toAttachments(message.attachments) } : {}),
    metadata: {
      ...(message.usage ? { steps: [{ messageId: message.id, usage: message.usage }] } : {}),
      custom: {
        graphId: message.id,
        parentId: message.parentId,
        modelId: message.modelId,
        modelIndex: message.modelIndex,
        complete: message.complete,
        runId: message.runId,
        files: message.files,
        ...(message.attachments.length && !isUser ? { attachments: message.attachments } : {}),
        statusHistory: message.statusHistory,
        ...(message.error ? { error: message.error } : {})
      }
    }
  };
}

export interface ThreadProjection {
  messages: ThreadMessageLike[];
  /** Graph id of the branch end the projection renders, so route writes address a stored row. */
  leafId: string | null;
}

/**
 * Keeps reasoning start/end times the client already measured when a reload
 * returns the same messages without those fields. assistant-ui needs both to
 * render a stable "Thought for Ns" label.
 */
export function keepReasoningTiming(previous: ConversationGraph | null, next: ConversationGraph): ConversationGraph {
  if (!previous) return next;
  return {
    ...next,
    messages: next.messages.map((message) => {
      const before = previous.messages.find((item) => item.id === message.id);
      if (!before) return message;
      const prior = before.output.find((block) => block.kind === 'reasoning');
      if (!prior?.startedAt) return message;
      if (!message.output.some((block) => block.kind === 'reasoning')) {
        return { ...message, output: [prior, ...message.output] };
      }
      let changed = false;
      const output = message.output.map((block) => {
        if (block.kind !== 'reasoning') return block;
        const startedAt = block.startedAt ?? prior.startedAt;
        const completedAt = block.completedAt ?? prior.completedAt;
        if (startedAt === block.startedAt && completedAt === block.completedAt) return block;
        changed = true;
        return { ...block, ...(startedAt ? { startedAt } : {}), ...(completedAt ? { completedAt } : {}) };
      });
      return changed ? { ...message, output } : message;
    })
  };
}

/**
 * Projects the branch that ends at `messageId`, or the newest leaf when no message is named.
 * A named message that is no longer stored falls back to the active branch instead of
 * projecting nothing. Sibling branches stay in the graph untouched; only the visible path
 * is projected, which is what keeps a branch switch a graph operation rather than a
 * client-side rewrite.
 */
export function projectConversationThread(graph: ConversationGraph | null, messageId?: string | null): ThreadProjection {
  if (!graph) return { messages: [], leafId: null };
  const named = Boolean(messageId && graph.messages.some((message) => message.id === messageId));
  const leaf = named ? messageId! : activeLeaf(graph);
  if (!leaf) return { messages: graph.messages.length ? [] : [], leafId: null };
  const path = messagePath(graph, leaf);
  return { messages: path.map(toThreadMessage), leafId: path.at(-1)?.id ?? null };
}

export { WELCOME };
