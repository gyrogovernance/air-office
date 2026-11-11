import type { ChatEventEnvelope } from '@office/contracts/chat';
import type { ChatRunState } from './chat.domain.public';
import type { ConversationMessage, MessageStatusEntry, OutputBlock } from './conversation-graph.entity';

export function projectConversationRun(message: ConversationMessage, state: ChatRunState, event: ChatEventEnvelope, initialContent = ''): ConversationMessage {
  let tools = message.output.filter((block) => block.kind !== 'text');
  let files = message.files;
  let status: MessageStatusEntry | null = null;
  if (event.type === 'reasoning-delta' && event.payload.text) {
    const index = tools.findIndex((block) => block.kind === 'reasoning');
    if (index < 0) tools = [...tools, { kind: 'reasoning', text: event.payload.text, status: 'running', startedAt: event.timestamp }];
    else tools = tools.map((block, position) => position === index ? { ...block, text: (block.text ?? '') + event.payload.text, status: block.status === 'ok' ? 'ok' : 'running', startedAt: block.startedAt ?? event.timestamp } : block);
  }
  if ((event.type === 'text-delta' || event.type === 'message-complete' || event.type === 'tool-request') && tools.some((block) => block.kind === 'reasoning' && block.status === 'running')) {
    tools = tools.map((block): OutputBlock => block.kind === 'reasoning' && block.status === 'running'
      ? { ...block, status: 'ok', completedAt: block.completedAt ?? event.timestamp }
      : block);
  }
  if (event.type === 'tool-request') {
    const call = event.payload;
    if (!tools.some((block) => block.toolCallId === call.toolCallId)) tools = [...tools, { kind: 'tool', ...call, status: 'running' }];
    status = { at: event.timestamp, label: call.name, state: 'running' };
  }
  if (event.type === 'tool-result') {
    const result = event.payload;
    tools = tools.map((block): OutputBlock => block.toolCallId === result.toolCallId ? { ...block, status: result.status, result: result.result, message: result.message } : block);
    status = { at: event.timestamp, label: tools.find((block) => block.toolCallId === result.toolCallId)?.name ?? 'Tool', state: result.status === 'ok' ? 'ok' : 'error', ...(result.message ? { detail: result.message } : {}) };
  }
  if (event.type === 'source-attachment') {
    if (!files.includes(event.payload.sourceId)) files = [...files, event.payload.sourceId];
    status = { at: event.timestamp, label: 'citation', state: 'ok', detail: event.payload.label };
  }
  const terminal = state.status === 'complete' || state.status === 'cancelled' || state.status === 'failed';
  if (terminal) {
    status = { at: event.timestamp, label: state.completion?.reason === 'length' ? 'length' : state.status, state: state.status === 'failed' ? 'error' : 'ok' };
    tools = tools.map((block): OutputBlock => block.kind === 'reasoning' && block.status === 'running'
      ? { ...block, status: 'ok', completedAt: block.completedAt ?? event.timestamp }
      : block);
  }
  return {
    ...message,
    content: initialContent + state.messages.map((part) => part.content).join('\n\n'),
    complete: state.status === 'complete' && state.completion?.reason !== 'length',
    output: [...(initialContent ? [{ kind: 'text' as const, text: initialContent + state.messages.map((part) => part.content).join('\n\n') }] : state.messages.map((part): OutputBlock => ({ kind: 'text', text: part.content }))), ...tools],
    files,
    usage: state.usage,
    error: state.failure,
    statusHistory: status && !message.statusHistory.some((item) => item.at === status.at && item.label === status.label && item.state === status.state) ? [...message.statusHistory, status] : message.statusHistory
  };
}
