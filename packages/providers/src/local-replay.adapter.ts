import type { ChatEventEnvelope, ChatEventPayloadMap, ChatEventType, ChatRunRequest, ProviderCapability, ProviderConnection, ProviderRunRequest } from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION } from '@office/contracts/chat';
import type { GeneratedImage, ImageGenerationRequest } from '@office/contracts/capability';
import { renderPromptImage } from './image-generation.adapter';

export interface ReplayStep<T extends ChatEventType = ChatEventType> { type: T; payload: ChatEventPayloadMap[T]; }
export interface LocalReplayOptions { id?: string; capabilities?: Partial<ProviderCapability>; script?: (request: ChatRunRequest) => ReplayStep[] | Promise<ReplayStep[]>; }

const defaultCapabilities: ProviderCapability = { streaming: true, tools: true, images: false, imageGeneration: true, models: ['local-replay'] };
const EDIT_INTENT = /\b(rewrite|revise|edit|clean up|tidy|rephrase)\b/i;
const proposedRewrite = (selection: string) => selection.replace(/\s+/g, ' ').trim();

function script(request: ChatRunRequest): ReplayStep[] {
  const messageId = `${request.runId}:message`;
  const question = request.messages.at(-1)?.content ?? '';
  const selection = request.context?.selection?.trim();
  const fileName = request.context?.fileName ?? 'the document';
  const answer = selection && EDIT_INTENT.test(question)
    ? `Proposing a reviewable rewrite of the ${selection.length}-character selection from ${fileName}. Apply it against the current file version to accept.`
    : selection ? `Reviewing the ${selection.length}-character selection from ${fileName}: this deterministic local provider echoes your request "${question}" so chat, streaming and error handling can be exercised without a live model.`
      : `Deterministic local provider: your request "${question}" is replayed verbatim so streaming assembly and durable history can be tested without consuming provider resources.`;
  const events: ReplayStep[] = answer.split(' ').map((word, index) => ({ type: 'text-delta', payload: { messageId, text: index ? ` ${word}` : word } } as ReplayStep<'text-delta'>));
  events.push({ type: 'message-complete', payload: { messageId, text: answer } }, { type: 'usage', payload: { inputTokens: question.length, outputTokens: answer.length } });
  const noteHandle = request.context?.fileId?.startsWith('note:') ? request.context.fileId.slice('note:'.length) : null;
  if (selection && EDIT_INTENT.test(question) && noteHandle) {
    const baseName = (request.context?.fileName ?? 'note.md').endsWith('.md')
      ? (request.context?.fileName ?? 'note.md')
      : `${(request.context?.fileName ?? 'note').replace(/\.note$/i, '')}.md`;
    const path = noteHandle.endsWith('.md') || noteHandle.endsWith('.note.json') || noteHandle.includes('/')
      ? (noteHandle.endsWith('.md') || noteHandle.endsWith('.note.json') ? noteHandle.replace(/\.note\.json$/i, '.md') : `${noteHandle}.md`)
      : `programs/general/notes/${baseName}`;
    const argumentsPayload = { path, markdown: proposedRewrite(selection) };
    const args = JSON.stringify(argumentsPayload);
    const split = Math.ceil(args.length / 2);
    events.push(
      { type: 'tool-arguments-fragment', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', argumentsDelta: args.slice(0, split) } },
      { type: 'tool-arguments-fragment', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', argumentsDelta: args.slice(split) } },
      { type: 'tool-request', payload: { toolCallId: `${request.runId}:apply-markdown-note`, name: 'apply_markdown_note', arguments: argumentsPayload } }
    );
  } else events.push({ type: 'completion', payload: { reason: 'stop' } });
  return events;
}

export class LocalReplayConnection implements ProviderConnection {
  readonly id: string;
  private readonly caps: ProviderCapability;
  private readonly replay: (request: ChatRunRequest) => ReplayStep[] | Promise<ReplayStep[]>;
  constructor(options: LocalReplayOptions = {}) { this.id = options.id ?? 'local-replay'; this.caps = { ...defaultCapabilities, ...options.capabilities }; this.replay = options.script ?? script; }
  capabilities(): ProviderCapability { return this.caps; }
  async generateImage(request: ImageGenerationRequest, _signal?: AbortSignal): Promise<GeneratedImage[]> {
    if (!this.caps.imageGeneration) throw new Error('This provider does not support image generation.');
    return [renderPromptImage(request.prompt)];
  }
  async *stream(request: ProviderRunRequest, signal?: AbortSignal): AsyncIterable<ChatEventEnvelope> {
    let sequence = 0;
    let terminal = false;
    for (const step of await this.replay(request)) {
      if (signal?.aborted) {
        yield this.event(request.runId, sequence, 'completion', { reason: 'cancelled' });
        return;
      }
      const payload = step.type === 'tool-request'
        ? { ...step.payload, approvalRequired: request.harness?.gatedToolNames.has((step.payload as ChatEventPayloadMap['tool-request']).name) ?? false }
        : step.payload;
      yield this.event(request.runId, sequence++, step.type, payload);
      if (step.type === 'completion' || step.type === 'failure') terminal = true;
      if (step.type === 'tool-request') {
        const toolRequest = step.payload as ChatEventPayloadMap['tool-request'];
        if (request.harness) {
          const definition = request.toolDefinitions?.find((tool) => tool.name === toolRequest.name);
          const toolId = definition?.id ?? toolRequest.name;
          if (request.harness.gatedToolNames.has(toolRequest.name)) {
            const approved = await request.harness.approveTool({ toolCallId: toolRequest.toolCallId, name: toolRequest.name, arguments: toolRequest.arguments }, signal);
            if (!approved) {
              yield this.event(request.runId, sequence++, 'tool-result', { toolCallId: toolRequest.toolCallId, status: 'error', message: 'The requested operation was not approved.' });
              yield this.event(request.runId, sequence++, 'completion', { reason: 'stop' });
              return;
            }
          }
          const result = await request.harness.invokeTool({ toolId, name: toolRequest.name, toolCallId: toolRequest.toolCallId, arguments: toolRequest.arguments }, signal);
          yield this.event(request.runId, sequence++, 'tool-result', { toolCallId: toolRequest.toolCallId, ...result });
        } else {
          yield this.event(request.runId, sequence++, 'completion', { reason: 'tool' });
          return;
        }
      }
    }
    if (!terminal) yield this.event(request.runId, sequence, 'completion', { reason: signal?.aborted ? 'cancelled' : 'stop' });
  }
  private event<T extends ChatEventType>(runId: string, sequence: number, type: T, payload: ChatEventPayloadMap[T]): ChatEventEnvelope<T> {
    return { protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${runId}:${sequence}`, runId, correlationId: runId, sequence, timestamp: new Date(0).toISOString(), type, payload };
  }
}
