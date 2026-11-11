import type { ChatEventEnvelope, ChatRunRequest, UserInputRequestPayload } from '@office/contracts/chat';
import { initialChatRunState, reduceChatEvent } from '@office/chat/domain';
import type { ChatRunState } from '@office/chat/domain';
import { resolveServiceBase } from '../shared/service-endpoint.hook';

/**
 * Transport for one chat run: authenticate against the local service, start the
 * run, then read its event stream until it ends. It reports every event to the
 * caller and returns the final assembled run state, so a chat turn and a
 * document proposal share one connection path instead of two copies of the
 * bootstrap and stream handling.
 */

export interface RunStreamInput {
  request: ChatRunRequest;
  signal?: AbortSignal;
  onEvent?: (event: ChatEventEnvelope) => void;
  /** Return `'delegated'` when another owner already claimed this interaction — do not POST. */
  onApproval?: (request: { toolCallId: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }) => Promise<boolean | 'delegated'>;
  onUserInput?: (request: { requestId: string; question: string; choices?: string[]; allowFreeform: boolean; url?: string; signal?: AbortSignal }) => Promise<{ answer: string; wasFreeform: boolean } | null | 'delegated'>;
}

export interface RunStreamResult {
  state: ChatRunState;
  /** Set when the caller cancelled, so a caller can tell cancellation from failure. */
  cancelled: boolean;
}

function describeStreamFailure(reason: unknown, fallback: string): Error {
  const message = reason instanceof Error ? reason.message.trim() : '';
  if (!message || message === 'Failed to fetch' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return new Error('AIR Office service is unavailable. Start the service and reload.', { cause: reason });
  }
  return reason instanceof Error ? reason : new Error(fallback);
}

export async function streamRun({ request, signal, onEvent, onApproval, onUserInput }: RunStreamInput): Promise<RunStreamResult> {
  const serviceBase = await resolveServiceBase();
  let bootstrap: Response;
  try {
    bootstrap = await fetch(`${serviceBase}/bootstrap`, { method: 'POST', headers: { origin: window.location.origin } });
  } catch (reason) {
    throw describeStreamFailure(reason, 'AIR Office service is unavailable.');
  }
  if (!bootstrap.ok) throw new Error('AIR Office service is unavailable.');
  const { token } = await bootstrap.json() as { token: string };
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  let submitted: Response;
  try {
    submitted = await fetch(`${serviceBase}/api/v1/runs`, { method: 'POST', headers, body: JSON.stringify(request) });
  } catch (reason) {
    throw describeStreamFailure(reason, 'Could not start the assistant run.');
  }
  if (!submitted.ok) {
    const body: unknown = await submitted.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Could not start the assistant run.';
    throw new Error(`${detail} (HTTP ${submitted.status})`);
  }
  const { events, cancel } = await submitted.json() as { events: string; cancel: string };

  /** Cancel must reach the service before the client settles, or a pending-run poll reattaches to a still-live provider turn. */
  let cancelSent: Promise<void> | null = null;
  const relay = () => {
    if (!cancelSent) {
      cancelSent = fetch(new URL(cancel, serviceBase), { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return cancelSent;
  };
  const onAbort = () => { void relay(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) void relay();

  let state: ChatRunState = initialChatRunState();
  let cancelled = false;
  let approvalError: Error | undefined;
  const interactions = new AbortController();
  const stopInteractions = () => interactions.abort();
  signal?.addEventListener('abort', stopInteractions, { once: true });
  if (signal?.aborted) stopInteractions();
  const pendingApprovals = new Set<string>();
  const terminal = () => state.status === 'complete' || state.status === 'cancelled' || state.status === 'failed';

  /* Read one SSE connection from `after` until it ends or the run reaches a
   * terminal state. Returns false when the socket dropped mid-stream so the
   * caller can reconnect and continue from the last acknowledged sequence. */
  const readStream = async (after: number): Promise<boolean> => {
    const url = new URL(events, serviceBase);
    if (after >= 0) url.searchParams.set('after', String(after));
    let stream: Response;
    try {
      stream = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal });
    } catch (reason) {
      if (signal?.aborted) throw reason;
      throw describeStreamFailure(reason, 'Could not connect to the assistant event stream.');
    }
    if (!stream.ok || !stream.body) throw new Error('Could not connect to the assistant event stream.');
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let cleanClose = false;
    try {
      while (!terminal()) {
        const { value, done } = await reader.read();
        if (done) { cleanClose = true; break; }
        buffered += decoder.decode(value, { stream: true });
        const frames = buffered.split('\n\n');
        buffered = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!data) continue;
          const event = JSON.parse(data) as ChatEventEnvelope;
          state = reduceChatEvent(state, event);
          onEvent?.(event);
          if (event.type === 'tool-request' && event.payload.approvalRequired && !pendingApprovals.has(event.payload.toolCallId)) {
            const { toolCallId, name, arguments: args } = event.payload;
            pendingApprovals.add(toolCallId);
            void (async () => {
              const decision = await onApproval?.({ toolCallId, name, arguments: args, signal: interactions.signal }) ?? false;
              if (decision === 'delegated' || interactions.signal.aborted) return;
              const response = await fetch(`${serviceBase}/api/v1/runs/${encodeURIComponent(event.runId)}/tool-approval`, { method: 'POST', headers, body: JSON.stringify({ toolCallId, approved: decision }) });
              if (!response.ok && response.status !== 409) throw new Error('The approval decision could not be sent.');
            })().catch((error: unknown) => {
              if (interactions.signal.aborted) return;
              approvalError = error instanceof Error ? error : new Error('The approval decision could not be sent.');
              relay();
            });
          }
          if (event.type === 'user-input-request' && !pendingApprovals.has(event.payload.requestId)) {
            const { requestId } = event.payload;
            pendingApprovals.add(requestId);
            void (async () => {
              let input = event.payload;
              if (input.transient) {
                const response = await fetch(`${serviceBase}/api/v1/runs/${encodeURIComponent(event.runId)}/interactions`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: interactions.signal });
                if (!response.ok) throw new Error('The pending request could not be retrieved.');
                const pending = await response.json() as { questions: UserInputRequestPayload[] };
                const current = pending.questions.find((item) => item.requestId === requestId);
                if (!current) return;
                input = current;
              }
              const answer = await onUserInput?.({ requestId, question: input.question, choices: input.choices, allowFreeform: input.allowFreeform, url: input.url, signal: interactions.signal }) ?? null;
              if (answer === 'delegated' || interactions.signal.aborted) return;
              const response = await fetch(`${serviceBase}/api/v1/runs/${encodeURIComponent(event.runId)}/user-input`, { method: 'POST', headers, body: JSON.stringify({ requestId, answer: answer?.answer ?? null, wasFreeform: answer?.wasFreeform ?? false }) });
              if (!response.ok && response.status !== 409) throw new Error('The answer could not be sent.');
            })().catch((error: unknown) => {
              if (interactions.signal.aborted) return;
              approvalError = error instanceof Error ? error : new Error('The answer could not be sent.');
              relay();
            });
          }
        }
      }
    } finally {
      try { reader.cancel(); } catch { /* already settled */ }
    }
    return cleanClose;
  };

  try {
    /* The local runtime can drop the SSE socket when a tool round or a long
     * generation stalls, even though the run kept going — the service records a
     * `failure`/`completion` event that a truncated stream never delivers.
     * Reconnecting once and replaying from `lastSequence` surfaces the real
     * outcome instead of a bare network error. */
    let clean = await readStream(-1);
    for (let attempt = 0; !terminal() && !signal?.aborted && attempt < 3; attempt += 1) {
      try { clean = await readStream(state.lastSequence) || clean; if (clean && terminal()) break; }
      catch { break; }
      if (!terminal()) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (!terminal() && !signal?.aborted && state.status === 'streaming')
      throw new Error('The assistant stopped responding mid-run. Reprint to try again.');
  } catch (reason) {
    if (signal?.aborted) cancelled = true;
    else throw reason;
  } finally {
    interactions.abort();
    signal?.removeEventListener('abort', stopInteractions);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted || cancelled || state.status === 'cancelled') await relay();
  }
  if (approvalError) throw approvalError;
  return { state, cancelled: cancelled || state.status === 'cancelled' };
}
