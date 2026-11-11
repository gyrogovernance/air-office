import { CopilotRequestHandler, type CopilotRequestContext } from '@github/copilot-sdk';

/** Adapt Copilot Responses requests to the ChatGPT plan endpoint's accepted format. */
export function prepareChatGptPlanRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('input' in value) || !Array.isArray(value.input)) {
    throw new Error('ChatGPT plan inference requires a Responses input array.');
  }
  const body: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const input = value.input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const message: Record<string, unknown> = Object.fromEntries(Object.entries(item));
    if (message.role === 'system') message.role = 'developer';
    if (Array.isArray(message.content)) {
      message.content = message.content.map((part: unknown) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) return part;
        return Object.fromEntries(Object.entries(part).filter(([key]) => key !== 'prompt_cache_breakpoint'));
      });
    }
    return message;
  });
  body.input = input;
  if (!('tools' in value) || !Array.isArray(value.tools)) return body;
  const localTools: unknown[] = [];
  const hostedTools: unknown[] = [];
  for (const tool of value.tools) {
    if (tool && typeof tool === 'object' && 'type' in tool
      && (tool.type === 'function' || tool.type === 'custom')) localTools.push(tool);
    else hostedTools.push(tool);
  }
  if (!localTools.length) return body;
  body.tools = hostedTools;
  // Keep names unchanged so Copilot dispatch and permission checks still own execution.
  body.input = [{ type: 'additional_tools', role: 'developer', tools: localTools }, ...input];
  return body;
}

/** API-key sessions share the runtime but must retain their ordinary request format. */
export class ChatGptPlanRequestHandler extends CopilotRequestHandler {
  private readonly sessions = new Set<string>();

  setSession(sessionId: string, enabled: boolean): void {
    if (enabled) this.sessions.add(sessionId);
    else this.sessions.delete(sessionId);
  }

  clear(): void { this.sessions.clear(); }

  protected override async sendRequest(request: Request, context: CopilotRequestContext): Promise<Response> {
    if (!context.sessionId || !this.sessions.has(context.sessionId)) return super.sendRequest(request, context);
    const body: unknown = await request.clone().json();
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    return super.sendRequest(new Request(request, {
      headers,
      body: JSON.stringify(prepareChatGptPlanRequest(body))
    }), context);
  }
}
