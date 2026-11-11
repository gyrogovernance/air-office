import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMessageQueue, useExternalStoreRuntime } from '@assistant-ui/react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppendMessage, ExternalStoreAdapter, ThreadMessageLike } from '@assistant-ui/react';
import type { ChatRunRequest, ChatTurn, ToolRequestPayload, UserInputRequestPayload } from '@office/contracts/chat';
import type { ConversationGraph, ConversationSummary, MessageAttachment } from '@office/chat/domain';
import { messagePath } from '@office/chat/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { type ConversationClient } from './conversation-client.adapter';
import { chatPath, parseChatRoute, restoredConversationId } from './chat-routing.policy';
import { branchLeafId } from './graph-overview.policy';
import { chatSettingsKey, chatToolIdsKey, clearChatDraftIfMatches, readChatSettings, readChatToolIds, toMessageAttachments, writeChatSettings, writeChatToolIds } from './composer.policy';
import { createChatAttachmentAdapter } from './composer-attachment.adapter';
import { deriveFollowUps, planMessageDelete } from './message-actions.policy';
import { streamRun } from './run-stream.adapter';
import { HISTORY_CACHE_MAX, HISTORY_PAGE_SIZE, prependHistoryPage, replaceHistoryWindow, windowPathHeadId } from './chat-history-window.policy';
import { keepReasoningTiming, projectConversationThread, WELCOME_MESSAGE_ID } from './thread-message.adapter';

/**
 * The assistant runtime over the service conversation graph.
 *
 * The service owns the graph; this hook holds a bounded read model (a path window plus
 * siblings for branch pickers) and hands the runtime the projected branch. A send, a
 * stop and a regenerate resolve to a graph write plus a windowed reload, so the thread
 * never parks a full transcript in React state.
 */

export interface ChatRuntimeDeps {
  client: ServiceClient;
  conversations: ConversationClient;
  buildRequest: (turns: ChatTurn[], context: string) => Promise<ChatRunRequest>;
  /** The disclosure the composer carries into the next request: selected text and retrieved sources. */
  getContext: () => string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onToolApproval?: (input: { toolCallId?: string; name: string; arguments: Record<string, unknown>; signal?: AbortSignal }) => Promise<boolean>;
  onUserInput?: (input: { requestId?: string; question: string; choices?: string[]; allowFreeform: boolean; url?: string; signal?: AbortSignal }) => Promise<{ answer: string; wasFreeform: boolean } | null>;
  /** Fired when open_path (or similar) successfully asks the UI to show a workspace path. */
  onOpenWorkspacePath?: (path: string) => void;
  /** Fired when open_in_code asks the UI to show a file in the Code workbench. */
  onOpenInCode?: (input: { rootPath: string; filePath?: string }) => void;
}

function isPendingRun(message: ConversationGraph['messages'][number]): boolean {
  return Boolean(message.runId && !message.complete && !message.error && !['cancelled', 'length'].includes(message.statusHistory.at(-1)?.label ?? ''));
}

function textOf(content: ThreadMessageLike['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('');
}

function chatTurn(message: ConversationGraph['messages'][number]): ChatTurn {
  if (message.role === 'user') return { role: 'user', content: message.content, ...(message.attachments.length ? { attachments: message.attachments.filter(item => item.kind === 'file').map(item => ({ id: item.id, label: item.label, mediaType: item.version ?? 'application/octet-stream' })) } : {}) };
  return { role: message.role, content: message.content };
}

/** Root field stamped on queued messages so their dispatch reaches the chat that queued them. */
const QUEUED_FOR = '__airOfficeConversationId';
const QUEUE_ITEM = '__airOfficeQueueItemId';
const TURN_IDENTITY = '__airOfficeTurnIdentity';
type TurnIdentity = { userId: string; assistantId: string; conversationId?: string; parentId?: string | null };
type TaggedAppendMessage = AppendMessage & { [QUEUED_FOR]?: string | null; [QUEUE_ITEM]?: string; [TURN_IDENTITY]?: TurnIdentity };

export function useChatRuntime(deps: ChatRuntimeDeps) {
  const { conversations } = deps;
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const navigateRef = useRef(navigate);
  locationRef.current = location;
  navigateRef.current = navigate;
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [graph, setGraph] = useState<ConversationGraph | null>(null);
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /**
   * The branch the thread projects: a focused leaf id, or null for the active
   * branch. Sends, retries and edits move the focus to the row they create, so
   * the rendered path always follows the work in flight.
   */
  const [focusLeafId, setFocusLeafId] = useState<string | null>(null);
  const focusLeafRef = useRef<string | null>(null);
  focusLeafRef.current = focusLeafId;
  const applyFocus = useCallback((leaf: string | null) => {
    focusLeafRef.current = leaf;
    setFocusLeafId(leaf);
  }, []);
  const navigateToChat = useCallback((id: string | null, messageId?: string | null) => {
    const target = chatPath(id, messageId) ?? '/';
    if (locationRef.current.pathname !== target) navigateRef.current(target);
  }, []);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [hasLater, setHasLater] = useState(false);
  const hasEarlierRef = useRef(false);
  const hasLaterRef = useRef(false);
  hasEarlierRef.current = hasEarlier;
  hasLaterRef.current = hasLater;

  /** Switches the projection to a sibling branch; reloads that branch's newest window when needed. */
  const focusBranch = useCallback((messageId: string) => {
    const graph = graphRef.current;
    const id = conversationIdRef.current;
    if (sendLock.current || !id) return;
    if (graph?.messages.some((message) => message.id === messageId)) {
      const leaf = branchLeafId(graph, messageId);
      if (!leaf) return;
      applyFocus(leaf);
      navigateToChat(id, leaf);
      void conversations.historyPage(id, { fromEnd: true, limit: HISTORY_PAGE_SIZE, leafId: leaf }).then((page) => {
        if (!page || conversationIdRef.current !== id) return;
        const conversation = page.conversation ?? graph.conversation;
        const next = replaceHistoryWindow(conversation, page.messages, { hasEarlier: page.hasEarlier, hasLater: page.hasLater });
        setGraph(next.graph);
        setHasEarlier(next.hasEarlier);
        setHasLater(next.hasLater);
      }).catch(() => undefined);
      return;
    }
    void conversations.historyPage(id, { fromEnd: true, limit: HISTORY_PAGE_SIZE, leafId: messageId }).then((page) => {
      if (!page || conversationIdRef.current !== id) return;
      const conversation = page.conversation ?? graph?.conversation;
      if (!conversation) return;
      const next = replaceHistoryWindow(conversation, page.messages, { hasEarlier: page.hasEarlier, hasLater: page.hasLater });
      setGraph(next.graph);
      setHasEarlier(next.hasEarlier);
      setHasLater(next.hasLater);
      applyFocus(page.leafId ?? messageId);
      navigateToChat(id, page.leafId ?? messageId);
    }).catch(() => depsRef.current.onError('This branch could not be opened.'));
  }, [applyFocus, conversations, navigateToChat]);

  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const graphRef = useRef<ConversationGraph | null>(null);
  const summariesRef = useRef<ConversationSummary[]>([]);
  const depsRef = useRef(deps);
  const sendLock = useRef(false);
  const openEpoch = useRef(0);
  /**
   * Bumped when a live run is cancelled for a queue Steer so the superseded
   * turn's `finally` cannot clear the lock or busy edge the steered turn owns.
   */
  const runGeneration = useRef(0);
  /** Mirrors `sending` synchronously so queue draining never races a run that React has not re-rendered yet. */
  const sendingRef = useRef(false);
  const deliverRef = useRef<(message: AppendMessage) => Promise<void>>(async () => undefined);
  /** Queued messages retain their originating chat, keyed by queue item id. */
  const queuedMessagesRef = useRef<Map<string, AppendMessage>>(new Map());
  /**
   * Aborts the in-flight turn when the user presses Run now on a queued item.
   * Kept on a ref because the queue controller is created once for the app.
   * Not passed as `createMessageQueue({ cancel })`: that makes every mid-run
   * composer steer interrupt immediately and skips the queue UI.
   */
  const queueCancelRef = useRef<() => void>(() => undefined);
  /**
   * The assistant-ui message queue: a send made while a response runs waits in
   * it, the driver below dispatches it once the run settles, and the busy and
   * idle edges tell the controller when a run holds the line. Creating it here
   * keeps one queue across conversation switches for the lifetime of the app.
   * A dispatch failure restores the queued turn for another attempt.
   */
  const queueController = useMemo(() => createMessageQueue({
    run: (message) => deliverRef.current(message).then(() => {
      const id = (message as TaggedAppendMessage)[QUEUE_ITEM];
      if (id) queuedMessagesRef.current.delete(id);
    }),
  }), []);
  const tryLiveSteer = useCallback(async (message: AppendMessage): Promise<boolean> => {
    const raw = textOf(message.content);
    const content = raw.trim();
    if (!content || (message.attachments?.length ?? 0) > 0) return false;
    const target = conversationIdRef.current;
    const liveRun = graphRef.current?.conversation.id === target
      ? graphRef.current.messages.find(isPendingRun)
      : undefined;
    if (!liveRun?.runId || !target || !sendingRef.current) return false;
    const response = await depsRef.current.client.request(`/api/v1/runs/${encodeURIComponent(liveRun.runId)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ prompt: content })
    });
    if (!response.ok) return false;
    clearChatDraftIfMatches(window.localStorage, target, raw);
    depsRef.current.onNotice(`Steered the current response: ${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`);
    return true;
  }, []);

  const trackedQueueAdapter = useMemo(() => {
    const controller = queueController.adapter;
    const tag = (message: AppendMessage): AppendMessage => ({ ...message, [QUEUED_FOR]: conversationIdRef.current, [TURN_IDENTITY]: { userId: crypto.randomUUID(), assistantId: crypto.randomUUID() } }) as TaggedAppendMessage;
    const pushTracked = (message: AppendMessage, lane: 'queue' | 'steer') => {
      const items = () => lane === 'queue' ? controller.items : controller.steerItems;
      const previous = new Set(items().map(item => item.id));
      const unsubscribe = queueController.subscribe(() => {
        const item = items().find(entry => !previous.has(entry.id));
        if (item) {
          (message as TaggedAppendMessage)[QUEUE_ITEM] = item.id;
          queuedMessagesRef.current.set(item.id, message);
        }
      });
      try {
        if (lane === 'queue') controller.enqueue(message);
        else controller.steer(message);
      } finally { unsubscribe(); }
    };
    return {
      ...controller,
      get items() { return controller.items; },
      get steerItems() { return controller.steerItems; },
      enqueue: (message: AppendMessage) => {
        void tryLiveSteer(message).then((steered) => {
          if (steered) return;
          pushTracked(tag(message), 'queue');
        }).catch(() => { pushTracked(tag(message), 'queue'); });
      },
      steer: (message: AppendMessage) => {
        void tryLiveSteer(message).then((steered) => {
          if (steered) return;
          pushTracked(tag(message), 'steer');
        }).catch(() => { pushTracked(tag(message), 'steer'); });
      },
      /**
       * Run now (`move` to steer, insertAfter null). Mid-run composer sends
       * must stay queued, so the queue driver has no `cancel` (that would make
       * `steer()` interrupt). Run now while a reply is live interrupts here
       * instead. Idle Run now re-arms a paused drain with a busy→idle nudge.
       */
      move: (queueItemId: string, placement: Parameters<typeof controller.move>[1]) => {
        const runNow = placement.lane === 'steer'
          && placement.insertAfter === null
          && placement.insertBefore === undefined;
        if (runNow && sendingRef.current) {
          const message = queuedMessagesRef.current.get(queueItemId) as TaggedAppendMessage | undefined;
          if (!message) {
            controller.move(queueItemId, placement);
            return;
          }
          queuedMessagesRef.current.delete(queueItemId);
          controller.remove(queueItemId);
          queueController.notifyCancelled();
          queueCancelRef.current();
          void deliverRef.current(message).catch(() => {
            pushTracked(message, 'steer');
          });
          return;
        }
        controller.move(queueItemId, placement);
        if (runNow && !sendingRef.current) {
          queueController.notifyBusy();
          queueController.notifyIdle();
        }
      },
      remove: (queueItemId: string) => {
        queuedMessagesRef.current.delete(queueItemId);
        controller.remove(queueItemId);
      },
      edit: (queueItemId: string, message: AppendMessage) => {
        const original = queuedMessagesRef.current.get(queueItemId) as TaggedAppendMessage | undefined;
        if (!original) throw new Error('This queued message cannot be edited.');
        if (original[TURN_IDENTITY]?.parentId !== undefined) throw new Error('Retry this message before editing it.');
        const edited: TaggedAppendMessage = { ...message, [QUEUED_FOR]: original[QUEUED_FOR], [QUEUE_ITEM]: queueItemId, [TURN_IDENTITY]: original[TURN_IDENTITY] };
        queuedMessagesRef.current.set(queueItemId, edited);
        controller.edit(queueItemId, edited);
      }
    };
  }, [queueController, tryLiveSteer]);
  /** Queue lanes live outside React, so their events push a revision into this hook. */
  const [queueRevision, setQueueRevision] = useState(0);
  graphRef.current = graph;
  summariesRef.current = summaries;
  depsRef.current = deps;

  const setSendingState = useCallback((value: boolean) => {
    if (value === sendingRef.current) return;
    sendingRef.current = value;
    /** Busy buffers further sends behind this run; idle lets the queue advance. */
    if (value) queueController.notifyBusy();
    else queueController.notifyIdle();
    setSending(value);
  }, [queueController]);

  useEffect(() => queueController.subscribe(() => setQueueRevision((revision) => revision + 1)), [queueController]);

  const refresh = useCallback(async () => {
    try {
      const next = await conversations.list({ archived: 'include' });
      setSummaries(next);
      return next;
    } catch {
      depsRef.current.onError('Stored conversations could not be loaded from the service.');
      return null;
    }
  }, [conversations]);

  const open = useCallback(async (id: string | null, messageId?: string | null, navigateRoute = true) => {
    /** Switching chats pauses the queue so nothing queued dispatches into a graph still loading. */
    queueController.hold();
    const epoch = ++openEpoch.current;
    if (id) window.localStorage.setItem('air-office:active-conversation', id);
    else window.localStorage.removeItem('air-office:active-conversation');
    if (navigateRoute) navigateToChat(id, messageId);
    conversationIdRef.current = id;
    setConversationId(id);
    setHasEarlier(false);
    setHasLater(false);
    /** Leaving a conversation parks its streamed response, so the composer never reports a run this view no longer watches. */
    if (!sendLock.current && !abortRef.current) setSendingState(false);
    if (!id) {
      applyFocus(null);
      setGraph(null);
      setLoaded(true);
      if (epoch === openEpoch.current) queueController.release();
      return;
    }
    try {
      const page = await conversations.historyPage(id, {
        fromEnd: true,
        limit: HISTORY_PAGE_SIZE,
        ...(messageId ? { leafId: messageId } : {}),
      });
      if (!page?.conversation) throw new Error('Unknown conversation');
      if (epoch !== openEpoch.current) return;
      const next = replaceHistoryWindow(page.conversation, page.messages, { hasEarlier: page.hasEarlier, hasLater: page.hasLater });
      setGraph(next.graph);
      setHasEarlier(next.hasEarlier);
      setHasLater(next.hasLater);
      applyFocus(page.leafId ?? messageId ?? null);
      setSummaries((current) => current.map((item) => item.id === id ? { ...item, unreadAt: null } : item));
      if (page.conversation.unreadAt !== null) void conversations.update(id, { unreadAt: null }).catch(() => undefined);
      setLoaded(true);
      queueController.release();
    } catch {
      if (epoch !== openEpoch.current) return;
      conversationIdRef.current = null;
      setConversationId(null);
      setGraph(null);
      setHasEarlier(false);
      setHasLater(false);
      window.localStorage.removeItem('air-office:active-conversation');
      if (navigateRoute) navigateToChat(null);
      depsRef.current.onError('This conversation could not be opened.');
      setLoaded(true);
      queueController.release();
    }
  }, [applyFocus, conversations, queueController, setSendingState]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = await refresh();
      if (cancelled) return;
      if (!listed) { setLoaded(true); return; }
      const route = parseChatRoute(locationRef.current.pathname);
      const onChatRoute = locationRef.current.pathname.startsWith('/chat/');
      const restoredId = restoredConversationId(listed, onChatRoute ? route.conversationId : window.localStorage.getItem('air-office:active-conversation'));
      await open(restoredId, restoredId === route.conversationId ? route.messageId : null, locationRef.current.pathname.startsWith('/chat/'));
    })();
    return () => { cancelled = true; };
  }, [conversations, open, refresh]);

  useEffect(() => {
    if (!loaded || !location.pathname.startsWith('/chat/')) return;
    const route = parseChatRoute(location.pathname);
    if (route.conversationId === conversationIdRef.current && route.messageId === focusLeafRef.current) return;
    void open(route.conversationId, route.messageId, location.pathname.startsWith('/chat/'));
  }, [loaded, location.pathname, open]);

  /** Reloads the bounded history window from the service after a turn settles. */
  const reloadGraph = useCallback(async (id: string, messageId?: string | null) => {
    const leafHint = messageId ?? focusLeafRef.current;
    const retained = Math.min(Math.max(graphRef.current?.messages.length ?? HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZE), HISTORY_CACHE_MAX);
    const page = await conversations.historyPage(id, {
      fromEnd: true,
      limit: retained,
      ...(leafHint ? { leafId: leafHint } : {}),
    }).catch(() => null);
    if (!page?.conversation || conversationIdRef.current !== id) return null;
    const windowed = replaceHistoryWindow(page.conversation, page.messages, { hasEarlier: page.hasEarlier, hasLater: page.hasLater });
    const merged = keepReasoningTiming(graphRef.current, windowed.graph);
    const assistant = messageId ? merged.messages.find((message) => message.id === messageId) : null;
    const loadedMessage = messageId ? page.messages.find((message) => message.id === messageId) : null;
    const remoteReasoning = loadedMessage?.output.find((block) => block.kind === 'reasoning');
    const localReasoning = assistant?.output.find((block) => block.kind === 'reasoning');
    if (assistant && localReasoning?.startedAt && (!remoteReasoning?.startedAt || localReasoning.completedAt && !remoteReasoning.completedAt)) {
      await conversations.updateMessage(id, assistant.id, { output: assistant.output }).catch(() => undefined);
    }
    setGraph(merged);
    setHasEarlier(windowed.hasEarlier);
    setHasLater(windowed.hasLater);
    const leaf = messageId ?? projectConversationThread(merged, focusLeafRef.current).leafId;
    if (leaf && locationRef.current.pathname.startsWith('/chat/')) navigateToChat(id, leaf);
    return merged;
  }, [conversations, navigateToChat]);

  useEffect(() => {
    const pending = graph?.messages.find(isPendingRun);
    if (!pending || abortRef.current || !conversationId || graph?.conversation.id !== conversationId) return;
    let cancelled = false;
    setSendingState(true);
    const timer = window.setInterval(() => {
      const retained = Math.min(Math.max(graphRef.current?.messages.length ?? HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZE), HISTORY_CACHE_MAX);
      void conversations.historyPage(conversationId, {
        fromEnd: true,
        limit: retained,
        leafId: pending.id,
      }).then((page) => {
        if (cancelled || conversationIdRef.current !== conversationId || !page?.conversation) return;
        const windowed = replaceHistoryWindow(page.conversation, page.messages, { hasEarlier: page.hasEarlier, hasLater: page.hasLater });
        setGraph(keepReasoningTiming(graphRef.current, windowed.graph));
        setHasEarlier(windowed.hasEarlier);
        setHasLater(windowed.hasLater);
        const current = page.messages.find((message) => message.id === pending.id);
        if (!current || !isPendingRun(current)) {
          setSendingState(false);
        }
      }).catch(() => { if (!cancelled) depsRef.current.onError('The running response could not be refreshed.'); });
    }, 750);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [graph, conversationId, conversations, setSendingState]);

  /** One owner per interaction id across live SSE and reconnect poll — prevents dual Ask-first dialogs. */
  const interactionClaims = useRef(new Set<string>());
  const claimInteraction = useCallback((key: string): boolean => {
    if (interactionClaims.current.has(key)) return false;
    interactionClaims.current.add(key);
    return true;
  }, []);
  const releaseInteraction = useCallback((key: string) => { interactionClaims.current.delete(key); }, []);

  const pendingRunId = graph?.conversation.id === conversationId ? graph.messages.find(isPendingRun)?.runId : undefined;
  useEffect(() => {
    // Live streamRun owns approvals while a turn is in flight; poll only for reconnect/resume.
    if (!pendingRunId || !conversationId || abortRef.current || sendingRef.current) return;
    const runPath = `/api/v1/runs/${encodeURIComponent(pendingRunId)}`;
    const dialogs = new Map<string, AbortController>();
    const settled = new Set<string>();
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || abortRef.current || sendingRef.current) return;
      polling = true;
      try {
        const pending = await depsRef.current.client.json<{ approvals: ToolRequestPayload[]; questions: UserInputRequestPayload[] }>(`${runPath}/interactions`);
        if (stopped) return;
        const keys = new Set([...pending.approvals.map((item) => `approval:${item.toolCallId}`), ...pending.questions.map((item) => `question:${item.requestId}`)]);
        for (const [key, controller] of dialogs) if (!keys.has(key)) { controller.abort(); dialogs.delete(key); releaseInteraction(key); }
        for (const key of settled) if (!keys.has(key)) settled.delete(key);
        for (const approval of pending.approvals) {
          const key = `approval:${approval.toolCallId}`;
          if (dialogs.has(key) || settled.has(key) || !claimInteraction(key)) continue;
          const controller = new AbortController();
          dialogs.set(key, controller);
          void (async () => {
            const approved = await depsRef.current.onToolApproval?.({ toolCallId: approval.toolCallId, name: approval.name, arguments: approval.arguments, signal: controller.signal }) ?? false;
            if (controller.signal.aborted) return;
            const response = await depsRef.current.client.request(`${runPath}/tool-approval`, { method: 'POST', body: JSON.stringify({ toolCallId: approval.toolCallId, approved }) });
            if (!response.ok && response.status !== 409) throw new Error('The approval decision could not be sent.');
            settled.add(key);
          })().catch((error: unknown) => { if (!controller.signal.aborted) depsRef.current.onError(error instanceof Error ? error.message : 'The approval decision could not be sent.'); }).finally(() => { if (dialogs.get(key) === controller) dialogs.delete(key); });
        }
        for (const question of pending.questions) {
          const key = `question:${question.requestId}`;
          if (dialogs.has(key) || settled.has(key) || !claimInteraction(key)) continue;
          const controller = new AbortController();
          dialogs.set(key, controller);
          void (async () => {
            const answer = await depsRef.current.onUserInput?.({ requestId: question.requestId, question: question.question, choices: question.choices, allowFreeform: question.allowFreeform, url: question.url, signal: controller.signal }) ?? null;
            if (controller.signal.aborted) return;
            const response = await depsRef.current.client.request(`${runPath}/user-input`, { method: 'POST', body: JSON.stringify({ requestId: question.requestId, answer: answer?.answer ?? null, wasFreeform: answer?.wasFreeform ?? false }) });
            if (!response.ok && response.status !== 409) throw new Error('The answer could not be sent.');
            settled.add(key);
          })().catch((error: unknown) => { if (!controller.signal.aborted) depsRef.current.onError(error instanceof Error ? error.message : 'The answer could not be sent.'); }).finally(() => { if (dialogs.get(key) === controller) dialogs.delete(key); });
        }
      } catch { /* The graph poll reports service connectivity failures. */ }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 750);
    return () => { stopped = true; window.clearInterval(timer); for (const [key, controller] of dialogs) { controller.abort(); releaseInteraction(key); } };
  }, [claimInteraction, conversationId, pendingRunId, releaseInteraction, sending]);

  const createConversation = useCallback(async (id: string = crypto.randomUUID()) => {
    await conversations.create(id);
    const draftTools = readChatToolIds(window.localStorage, null);
    if (draftTools !== null) {
      writeChatToolIds(window.localStorage, id, draftTools);
      window.localStorage.removeItem(chatToolIdsKey(null));
    }
    const draftSettings = readChatSettings(window.localStorage, null);
    if (Object.keys(draftSettings).length) {
      writeChatSettings(window.localStorage, id, draftSettings);
      window.localStorage.removeItem(chatSettingsKey(null));
    }
    await open(id);
    return id;
  }, [conversations, open]);

  const runTurn = useCallback(async (turns: ChatTurn[], context: string, assistantId: string, targetId: string | null = conversationIdRef.current, continuation?: { runId: string; content: string }) => {
    const id = targetId;
    const generation = ++runGeneration.current;
    const controller = new AbortController();
    abortRef.current = controller;
    let streamed = '';
    try {
      const built = await depsRef.current.buildRequest(turns, context);
      const request = { ...built, ...(id ? { conversation: { id, assistantMessageId: assistantId, ...(continuation ? { continueFrom: continuation.runId } : {}) } } : {}) };
      const result = await streamRun({
        request,
        signal: controller.signal,
        onApproval: (input) => {
          const key = `approval:${input.toolCallId}`;
          if (!claimInteraction(key)) return Promise.resolve('delegated' as const);
          return depsRef.current.onToolApproval?.(input) ?? Promise.resolve(false);
        },
        onUserInput: (input) => {
          const key = `question:${input.requestId}`;
          if (!claimInteraction(key)) return Promise.resolve('delegated' as const);
          return depsRef.current.onUserInput?.(input) ?? Promise.resolve(null);
        },
        onEvent: (event) => {
          if (event.type === 'tool-result' && event.payload.status === 'ok') {
            const result = event.payload.result;
            if (result && typeof result === 'object' && 'opened' in result && result.opened === true) {
              const surface = 'surface' in result && typeof result.surface === 'string' ? result.surface : '';
              if (surface === 'code' && 'rootPath' in result && typeof result.rootPath === 'string' && result.rootPath.trim()) {
                depsRef.current.onOpenInCode?.({
                  rootPath: result.rootPath,
                  ...('filePath' in result && typeof result.filePath === 'string' && result.filePath.trim()
                    ? { filePath: result.filePath }
                    : {}),
                });
              } else if ('path' in result && typeof result.path === 'string' && result.path.trim()) {
                depsRef.current.onOpenWorkspacePath?.(result.path);
              }
            }
          }
          if (event.type === 'reasoning-delta' && event.payload.text) {
            const at = new Date().toISOString();
            setGraph((current) => current ? { ...current, messages: current.messages.map((message) => {
              if (message.id !== assistantId) return message;
              const index = message.output.findIndex((block) => block.kind === 'reasoning');
              const output = index < 0
                ? [...message.output, { kind: 'reasoning' as const, text: event.payload.text, status: 'running' as const, startedAt: at }]
                : message.output.map((block, position) => position === index
                  ? { ...block, text: (block.text ?? '') + event.payload.text, status: block.status === 'ok' ? 'ok' as const : 'running' as const, startedAt: block.startedAt ?? at }
                  : block);
              return { ...message, output };
            }) } : current);
          }
          if (event.type === 'text-delta') {
            streamed += event.payload.text;
            const at = new Date().toISOString();
            setGraph((current) => current ? { ...current, messages: current.messages.map((message) => {
              if (message.id !== assistantId) return message;
              const output = message.output.map((block) => block.kind === 'reasoning' && block.status === 'running'
                ? { ...block, status: 'ok' as const, completedAt: block.completedAt ?? at }
                : block);
              return { ...message, content: (continuation?.content ?? '') + streamed, output };
            }) } : current);
          }
          if (event.type === 'message-complete') {
            if (event.payload.text) streamed = event.payload.text;
            const at = new Date().toISOString();
            setGraph((current) => current ? { ...current, messages: current.messages.map((message) => {
              if (message.id !== assistantId) return message;
              const output = message.output.map((block) => block.kind === 'reasoning' && !block.completedAt
                ? { ...block, status: 'ok' as const, completedAt: at, startedAt: block.startedAt ?? at }
                : block);
              return { ...message, content: (continuation?.content ?? '') + streamed, output };
            }) } : current);
          }
        }
      });
      const text = (continuation?.content ?? '') + (result.state.messages.at(-1)?.content ?? streamed);
      const cancelled = result.cancelled || result.state.status === 'cancelled';
      setGraph((current) => current ? {
        ...current,
        messages: current.messages.map((message) => {
          if (message.id !== assistantId) return message;
          if (!cancelled) return { ...message, content: text };
          const at = new Date().toISOString();
          const statusHistory = message.statusHistory.some((item) => item.label === 'cancelled')
            ? message.statusHistory
            : [...message.statusHistory, { at, label: 'cancelled', state: 'ok' as const }];
          return { ...message, content: text, statusHistory };
        }),
      } : current);
      if (id && conversationIdRef.current === id) {
        await conversations.update(id, { unreadAt: null }).catch(() => undefined);
        await reloadGraph(id, assistantId);
      }
      if (result.state.status === 'failed' && result.state.failure) depsRef.current.onError(result.state.failure.message);
      void refresh();
    } catch (reason) {
      depsRef.current.onError(reason instanceof Error ? reason.message : 'The assistant stream failed.');
      if (id) {
        const saved = graphRef.current?.messages.find((message) => message.id === assistantId);
        if (saved && !saved.runId) await conversations.updateMessage(id, assistantId, { content: streamed, complete: false, error: { code: 'run-not-started', message: reason instanceof Error ? reason.message : 'The run could not start.' } }).catch(() => undefined);
        if (conversationIdRef.current === id) await reloadGraph(id);
      }
    } finally {
      if (generation !== runGeneration.current) {
        /** Steer interrupt already owns the busy edge; only release the suppressed idle. */
        queueController.notifyIdle();
        return;
      }
      abortRef.current = null;
      sendLock.current = false;
      setSendingState(false);
      interactionClaims.current.clear();
    }
  }, [claimInteraction, conversations, queueController, refresh, reloadGraph, setSendingState]);

  const newConversation = useCallback(() => {
    void createConversation().catch(() => depsRef.current.onError('Could not create a new conversation.'));
  }, [createConversation]);

  /**
   * Stores the composed message on the service and starts its run. One dispatch
   * runs at a time behind `sendLock`; every failure before the append commits
   * returns false without touching the run state, which lets the queue restore
   * the message and keep it for a later attempt. The target chat may differ
   * from the open one, in which case its stored graph is loaded for the append
   * and the run writes into that conversation while this view stays where it is.
   */
  const dispatchMessage = useCallback(async (target: string | null, content: string, attachments: MessageAttachment[], identity: TurnIdentity): Promise<boolean> => {
    if (!content || sendLock.current) return false;
    sendLock.current = true;
    let id = target;
    try {
      if (!id) { identity.conversationId ??= crypto.randomUUID(); id = await createConversation(identity.conversationId); }
    } catch {
      sendLock.current = false;
      depsRef.current.onError('Could not create a conversation. Your message is kept.');
      return false;
    }
    const source = await conversations.load(id).catch(() => null);
    if (!source) {
      sendLock.current = false;
      depsRef.current.onError('This message could not be stored. The conversation was not sent.');
      return false;
    }
    const offView = id !== conversationIdRef.current;

    const { userId, assistantId } = identity;
    const projected = projectConversationThread(source, offView ? null : focusLeafRef.current).messages.filter((item) => item.id !== WELCOME_MESSAGE_ID);
    if (identity.parentId === undefined) identity.parentId = projected.at(-1)?.id ?? null;
    const prior = identity.parentId && source ? messagePath(source, identity.parentId).filter(item => item.id !== WELCOME_MESSAGE_ID) : [];
    try {
      const saved = await conversations.appendTurn({ conversationId: id, userId, assistantId, parentId: identity.parentId, content, attachments });
      if (saved.messages.find(item => item.id === assistantId)?.runId) { sendLock.current = false; if (id === conversationIdRef.current) await reloadGraph(id, assistantId); queueController.notifyIdle(); return true; }
    } catch (reason) {
      depsRef.current.onError(reason instanceof Error ? reason.message : 'This message could not be stored. The conversation was not sent.');
      sendLock.current = false;
      await reloadGraph(id);
      return false;
    }
    const summary = summariesRef.current.find((item) => item.id === id);
    if (!summary || summary.title === 'New conversation') await conversations.update(id, { title: content.slice(0, 60) }).catch(() => undefined);
    /** The commit edge: from here the run owns the busy state the queue tracks. */
    setSendingState(true);
    if (id === conversationIdRef.current) {
      applyFocus(assistantId);
      await reloadGraph(id);
    }
    void refresh();
    const turns = prior.map(chatTurn);
    const current: ChatTurn = { role: 'user', content, ...(attachments.length ? { attachments: attachments.filter(item => item.kind === 'file').map(item => ({ id: item.id, label: item.label, mediaType: item.version ?? 'application/octet-stream' })) } : {}) };
    void runTurn([...turns, current], depsRef.current.getContext(), assistantId, id);
    return true;
  }, [applyFocus, conversations, createConversation, queueController, refresh, reloadGraph, runTurn, setSendingState]);

  /**
   * Delivers one composed message: this is what the queue calls when a run
   * settles, and what the store's own send calls while idle. A rejected store
   * throws so the queue restores the message instead of losing it. An off-screen
   * target is checked against the conversation store before dispatch.
   */
  const deliver = useCallback(async (message: AppendMessage) => {
    const raw = textOf(message.content);
    const content = raw.trim();
    if (!content) return;
    if (await tryLiveSteer(message)) return;
    const tagged = (message as TaggedAppendMessage)[QUEUED_FOR];
    const target = tagged === undefined ? conversationIdRef.current : tagged;
    const attachments = toMessageAttachments(message.attachments ?? []);
    const taggedMessage = message as TaggedAppendMessage;
    const identity = taggedMessage[TURN_IDENTITY] ??= { userId: crypto.randomUUID(), assistantId: crypto.randomUUID() };
    const stored = await dispatchMessage(target, content, attachments, identity);
    if (!stored) throw new Error('The message could not be stored.');
    clearChatDraftIfMatches(window.localStorage, target, raw);
  }, [dispatchMessage, tryLiveSteer]);
  const onNew = useCallback((message: AppendMessage) => deliver(message), [deliver]);
  deliverRef.current = deliver;

  /**
   * Queue Steer cancel: bump generation so the aborted turn's `finally` cannot
   * steal the steered turn's lock, then abort the live stream and server run.
   */
  queueCancelRef.current = () => {
    runGeneration.current += 1;
    sendLock.current = false;
    const live = abortRef.current;
    abortRef.current = null;
    live?.abort();
    const run = graphRef.current?.messages.find(isPendingRun);
    if (run?.runId) {
      void depsRef.current.client.request(`/api/v1/runs/${encodeURIComponent(run.runId)}`, { method: 'DELETE' })
        .catch(() => undefined);
    }
  };

  const stop = useCallback(() => {
    /** Pending sends wait out this cancel instead of firing the moment it settles. */
    queueController.notifyCancelled();
    const run = graphRef.current?.messages.find(isPendingRun);
    /** Mark cancelled locally first so the pending-run poll cannot revive `sending` after abort clears. */
    if (run) {
      const at = new Date().toISOString();
      setGraph((current) => current ? {
        ...current,
        messages: current.messages.map((message) => {
          if (message.id !== run.id) return message;
          if (message.statusHistory.some((item) => item.label === 'cancelled')) return message;
          return { ...message, statusHistory: [...message.statusHistory, { at, label: 'cancelled', state: 'ok' as const }] };
        }),
      } : current);
    }
    const live = abortRef.current;
    live?.abort();
    if (run?.runId) {
      void depsRef.current.client.request(`/api/v1/runs/${encodeURIComponent(run.runId)}`, { method: 'DELETE' })
        .catch(() => depsRef.current.onError('Could not stop this response.'));
    }
    /** Live turns clear `sending` in their own settle; parked reconnect polls have no settle. */
    if (!live) setSendingState(false);
  }, [queueController, setSendingState]);

  /** Shared retry core: stores a fresh assistant row under the anchor and reruns the turn. */
  const rerunFrom = useCallback(async (anchorId: string, steer: string | null) => {
    if (sendLock.current) return;
    const graph = graphRef.current;
    const id = conversationIdRef.current;
    if (!graph) return;
    sendLock.current = true;
    const assistantId = crypto.randomUUID();
    if (id) {
      try { await conversations.appendMessage({ conversationId: id, id: assistantId, parentId: anchorId, role: 'assistant', content: '', complete: false, ...(steer ? { statusHistory: [{ at: new Date().toISOString(), label: 'refinement', state: 'ok', detail: steer }] } : {}) }); }
      catch { sendLock.current = false; depsRef.current.onError('The retry could not be stored.'); return; }
      if (id === conversationIdRef.current) {
        applyFocus(assistantId);
        await reloadGraph(id);
      }
    }
    setSendingState(true);
    const upto = messagePath(graph, anchorId).filter((item) => item.id !== WELCOME_MESSAGE_ID);
    const turns = upto.map(chatTurn);
    await runTurn(steer && turns.length ? [...turns.slice(0, -1), { ...turns.at(-1)!, content: `${turns.at(-1)!.content}\n\nFollow this instruction for the new answer: ${steer}` }] : turns, depsRef.current.getContext(), assistantId, id);
  }, [applyFocus, conversations, reloadGraph, runTurn, setSendingState]);

  const onReload = useCallback(async (parentId: string | null) => {
    if (sendLock.current) return;
    const graph = graphRef.current;
    if (!graph) return;
    const anchorId = (parentId
      ? graph.messages.find((item) => item.id === parentId)
      : projectConversationThread(graph, focusLeafRef.current).messages.filter((item) => item.id !== WELCOME_MESSAGE_ID).at(-1))?.id;
    if (!anchorId) return;
    await rerunFrom(anchorId, null);
  }, [rerunFrom]);

  /**
   * Continue (CHAT-094): an interrupted assistant message keeps its row and
   * receives the rest of the response, so the stored history stays one thread
   * instead of growing a sibling.
   */
  const continueMessage = useCallback(async (messageId: string) => {
    if (sendLock.current) return;
    const id = conversationIdRef.current;
    const graph = graphRef.current;
    const source = graph?.messages.find((item) => item.id === messageId);
    if (!id || !graph || !source || source.role !== 'assistant') return;
    const prior = source.content.trim();
    // A continue cue with no prior text makes models invent ask-user / task forms.
    // Empty incomplete rows regenerate from the parent instead.
    if (!prior) {
      if (source.parentId) await rerunFrom(source.parentId, null);
      return;
    }
    sendLock.current = true;
    setSendingState(true);
    /* A stopped row keeps `cancelled` as its latest status until the service
     * reloads; mark it running locally so Continue disappears and Streaming shows. */
    setGraph((current) => current ? {
      ...current,
      messages: current.messages.map((message) => message.id !== messageId ? message : {
        ...message,
        error: null,
        statusHistory: [...message.statusHistory, { at: new Date().toISOString(), label: 'running', state: 'running' as const }]
      })
    } : current);
    const ancestry = messagePath(graph, source.id).filter((item) => item.id !== WELCOME_MESSAGE_ID && item.id !== source.id);
    const turns: ChatTurn[] = ancestry.map(chatTurn);
    if (source.runId) {
      turns.push({ role: 'assistant', content: prior });
      const refinement = source.statusHistory.find(entry => entry.label === 'refinement')?.detail;
      turns.push({ role: 'user', content: `Continue your previous response from where it stopped. Do not repeat the existing text.${refinement ? `\n\nKeep following the refinement instruction: ${refinement}` : ''}` });
    }
    await runTurn(turns, depsRef.current.getContext(), source.id, id, source.runId ? { runId: source.runId, content: prior } : undefined);
  }, [rerunFrom, runTurn, setSendingState]);

  /**
   * Regenerate with refinement (CHAT-153): a user instruction steers the retry
   * without adding a stored user message; the instruction is retained on the response.
   */
  const regenerateWithRefinement = useCallback(async (messageId: string, instruction: string) => {
    const graph = graphRef.current;
    const source = graph?.messages.find((item) => item.id === messageId);
    const steer = instruction.trim();
    if (!graph || !source || !steer || !source.parentId) return;
    await rerunFrom(source.parentId, steer);
  }, [rerunFrom]);

  /** Edit-and-branch: the edited copy becomes a new sibling and the original subtree stays reachable. */
  const branch = useCallback(async (messageId: string, edited: string) => {
    const id = conversationIdRef.current;
    const graph = graphRef.current;
    const source = graph?.messages.find((item) => item.id === messageId);
    const next = edited.trim();
    if (!id || !graph || !source || !next || sendLock.current) return;
    const ancestry = messagePath(graph, source.id).filter((item) => item.id !== WELCOME_MESSAGE_ID);
    sendLock.current = true;
    const newUserId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    try {
      await conversations.appendMessage({ conversationId: id, id: newUserId, parentId: source.parentId, role: 'user', content: next, complete: true, attachments: source.attachments });
      await conversations.appendMessage({ conversationId: id, id: assistantId, parentId: newUserId, role: 'assistant', content: '', complete: false });
    } catch {
      sendLock.current = false;
      depsRef.current.onError('The edited message could not be stored.');
      return;
    }
    applyFocus(assistantId);
    await reloadGraph(id, assistantId);
    setSendingState(true);
    const turns = ancestry.slice(0, -1).map(chatTurn);
    await runTurn([...turns, chatTurn({ ...source, content: next })], depsRef.current.getContext(), assistantId);
  }, [applyFocus, conversations, reloadGraph, runTurn, setSendingState]);

  const updateMeta = useCallback(async (id: string, update: Parameters<ConversationClient['update']>[1], failure: string) => {
    setSummaries((current) => current.map((summary) => summary.id !== id ? summary : {
      ...summary,
      ...(update.title !== undefined ? { title: update.title } : {}),
      ...(update.pinned !== undefined ? { pinned: update.pinned } : {}),
      ...(update.archived !== undefined ? { archivedAt: update.archived ? new Date().toISOString() : null } : {}),
      ...(update.folderId !== undefined ? { folderId: update.folderId } : {}),
      ...(update.tags !== undefined ? { tags: update.tags } : {}),
      ...(update.unreadAt !== undefined ? { unreadAt: update.unreadAt } : {})
    }));
    try { await conversations.update(id, update); }
    catch { depsRef.current.onError(failure); await refresh(); }
  }, [conversations, refresh]);

  const remove = useCallback(async (id: string) => {
    try { await conversations.remove(id); } catch { depsRef.current.onError('This chat could not be deleted.'); return; }
    setSummaries((current) => current.filter((summary) => summary.id !== id));
    if (id === conversationIdRef.current) void open(null);
  }, [conversations, open]);

  const clone = useCallback(async (id: string) => {
    try {
      const source = await conversations.load(id);
      if (!source) throw new Error('missing');
      const newId = crypto.randomUUID();
      await conversations.create(newId);
      await conversations.update(newId, { title: `${source.conversation.title} copy`, pinned: false, folderId: source.conversation.folderId, tags: source.conversation.tags });
      const ids = new Map(source.messages.map((message) => [message.id, crypto.randomUUID()]));
      for (const message of source.messages) {
        const copyId = ids.get(message.id);
        if (!copyId) continue;
        await conversations.appendMessage({ ...message, conversationId: newId, id: copyId, parentId: message.parentId ? ids.get(message.parentId) ?? null : null, runId: null });
      }
      await refresh();
    } catch { depsRef.current.onError('This chat could not be cloned.'); }
  }, [conversations, refresh]);

  /** Saves an edited message in place: the row keeps its identity and its replies stay reachable. */
  const saveMessage = useCallback(async (messageId: string, content: string) => {
    const id = conversationIdRef.current;
    const next = content.trim();
    if (!id || !next || sendLock.current) return;
    try { await conversations.updateMessage(id, messageId, { content: next }); }
    catch { depsRef.current.onError('The edited message could not be saved.'); return; }
    await reloadGraph(id);
  }, [conversations, reloadGraph]);

  /** Deletes the branch a message roots; the plan comes from the same policy the dialog reads. */
  const deleteMessage = useCallback(async (messageId: string) => {
    const id = conversationIdRef.current;
    if (!id || sendLock.current) return;
    const source = await conversations.load(id).catch(() => graphRef.current);
    if (!source) return;
    const plan = planMessageDelete(source, messageId);
    if (!plan) return;
    try { await conversations.deleteMessages(id, plan.messageIds); }
    catch { depsRef.current.onError('These messages could not be deleted.'); return; }
    if (focusLeafRef.current && plan.messageIds.includes(focusLeafRef.current)) applyFocus(null);
    await reloadGraph(id);
    void refresh();
  }, [applyFocus, conversations, reloadGraph, refresh]);

  /**
   * Forks the conversation at a message into a new conversation: the copy keeps
   * the ancestry up to that row, and nothing stored after it travels along.
   */
  const forkFrom = useCallback(async (messageId: string) => {
    const id = conversationIdRef.current;
    if (!id) return null;
    if (sendLock.current) {
      depsRef.current.onNotice('Wait for the current response to finish before starting a new chat from here.');
      return null;
    }
    // Fork needs the full stored path, not the bounded window retained for the thread.
    const source = await conversations.load(id).catch(() => null);
    if (!source) {
      depsRef.current.onError('This conversation could not be forked.');
      return null;
    }
    const path = messagePath(source, messageId).filter((item) => item.id !== WELCOME_MESSAGE_ID);
    if (!path.length) {
      depsRef.current.onError('This message could not be used as the start of a new chat.');
      return null;
    }
    const forkId = crypto.randomUUID();
    try {
      await conversations.create(forkId);
      await conversations.update(forkId, { title: `${source.conversation.title} fork` });
      const copies = new Map(path.map((item) => [item.id, crypto.randomUUID()]));
      for (const item of path) {
        await conversations.appendMessage({ ...item, conversationId: forkId, id: copies.get(item.id)!, parentId: item.parentId ? copies.get(item.parentId) ?? null : null, runId: null });
      }
    } catch {
      depsRef.current.onError('This conversation could not be forked.');
      return null;
    }
    void refresh();
    await open(forkId);
    depsRef.current.onNotice('Opened a new chat that keeps messages up to this point.');
    return forkId;
  }, [conversations, open, refresh]);

  const projection = useMemo(() => projectConversationThread(graph, focusLeafId), [graph, focusLeafId]);
  const visible = projection.messages;
  const hiddenAbove = hasEarlier ? HISTORY_PAGE_SIZE : 0;

  const attachmentAdapter = useMemo(() => createChatAttachmentAdapter(deps.client), [deps.client]);
  const onEdit = useCallback(async (message: AppendMessage) => {
    const sourceId = message.sourceId;
    if (!sourceId) return;
    await branch(sourceId, textOf(message.content));
  }, [branch]);
  const onLoadEarlier = useCallback(async () => {
    const id = conversationIdRef.current;
    const current = graphRef.current;
    const leaf = focusLeafRef.current ?? projectConversationThread(current, null).leafId;
    const head = windowPathHeadId(current, leaf);
    if (!id || !current || !head || !hasEarlierRef.current) return;
    const page = await conversations.historyPage(id, { before: head, limit: HISTORY_PAGE_SIZE, leafId: leaf }).catch(() => null);
    if (!page || conversationIdRef.current !== id) return;
    const next = prependHistoryPage(current, page.messages, { hasEarlier: page.hasEarlier, hasLater: hasLaterRef.current || page.hasLater });
    setGraph(keepReasoningTiming(graphRef.current, next.graph));
    setHasEarlier(next.hasEarlier);
    setHasLater(next.hasLater);
  }, [conversations]);
  const adapter: ExternalStoreAdapter<ThreadMessageLike> = useMemo(() => {
    const last = visible.at(-1);
    const suggestions = !sending && last?.role === 'assistant' && last.status?.type === 'complete'
      ? deriveFollowUps(textOf(last.content)).map((prompt) => ({ prompt }))
      : [];
    return {
      messages: visible,
      isRunning: sending,
      isLoading: !loaded,
      hasEarlier,
      suggestions,
      convertMessage: (message) => message,
      onLoadEarlier,
      onNew,
      onEdit,
      onCancel: async () => { stop(); },
      onReload: async (parentId) => { await onReload(parentId); },
      queue: trackedQueueAdapter,
      adapters: { attachments: attachmentAdapter },
      setMessages: () => { void reloadGraph(conversationIdRef.current ?? ''); }
    };
  }, [visible, sending, loaded, hasEarlier, onLoadEarlier, onNew, onEdit, stop, onReload, reloadGraph, trackedQueueAdapter, attachmentAdapter, queueRevision]);

  const assistantRuntime = useExternalStoreRuntime(adapter);

  return {
    assistantRuntime,
    adapter,
    summaries,
    conversationId,
    graph,
    sending,
    loaded,
    totalMessageCount: visible.length + (hasEarlier ? HISTORY_PAGE_SIZE : 0) + (hasLater ? HISTORY_PAGE_SIZE : 0),
    hiddenMessageCount: hiddenAbove,
    hasEarlier,
    hasLater,
    focusBranch,
    branch,
    saveMessage,
    deleteMessage,
    forkFrom,
    continueMessage,
    regenerateWithRefinement,
    open,
    newConversation,
    createConversation,
    updateMeta,
    remove,
    clone,
    refresh,
    stop
  };
}

export type ChatRuntime = ReturnType<typeof useChatRuntime>;
