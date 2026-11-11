import { useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { ChatRunRequest, ChatTurn } from '@office/contracts/chat';
import { Button, Card, Separator, TextArea } from '@heroui/react';
import { SelectField } from '../shared/select-field.component';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';
import { connectionIcon, type ModelChoice } from '../models/local-ai/model-label.policy';
import { parseModelKey } from './composer.policy';
import { createConversationClient } from './conversation-client.adapter';
import { streamRun } from './run-stream.adapter';
import { createServiceClient, type ServiceClient } from '../shared/service-client.hook';
import { answerAgentQuestion, confirmToolPermission, useAppDialogs } from '../shared/app-dialogs.component';

/**
 * Side-by-side model comparison baseline (F-011).
 *
 * Two independent Copilot runs share one prompt and one conversation graph.
 * Each column keeps its own modelIndex, abort controller, failure and cancel
 * state. There is no playground engine and no second agent framework.
 */

type ColumnStatus = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

type CompareColumn = {
  modelKey: string;
  modelIndex: number;
  assistantId: string;
  content: string;
  status: ColumnStatus;
  error: string;
};

function emptyColumn(modelIndex: number, modelKey = ''): CompareColumn {
  return { modelKey, modelIndex, assistantId: '', content: '', status: 'idle', error: '' };
}

function requestFor(modelKey: string, turns: ChatTurn[], conversationId: string, assistantId: string): ChatRunRequest {
  const parsed = parseModelKey(modelKey);
  if (!parsed.model) throw new Error('Choose a model for each column.');
  return {
    runId: crypto.randomUUID(),
    model: parsed.model,
    ...(parsed.provider ? { provider: parsed.provider } : {}),
    conversation: { id: conversationId, assistantMessageId: assistantId },
    messages: turns
  };
}

export function ModelCompare(props: {
  models: Array<Pick<ModelChoice, 'value' | 'label'> & Partial<Pick<ModelChoice, 'icon' | 'roles'>>>;
  client?: ServiceClient;
  appearance?: 'light' | 'dark';
  onOpenConversation?: (conversationId: string) => void;
}) {
  const dialogs = useAppDialogs();
  const client = useMemo(() => props.client ?? createServiceClient(), [props.client]);
  const conversations = useMemo(() => createConversationClient(client), [client]);
  const [prompt, setPrompt] = useState('');
  const [leftKey, setLeftKey] = useState(props.models[0]?.value ?? '');
  const [rightKey, setRightKey] = useState(props.models[1]?.value ?? props.models[0]?.value ?? '');
  const [columns, setColumns] = useState<[CompareColumn, CompareColumn]>([emptyColumn(0), emptyColumn(1)]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const aborts = useRef<[AbortController | null, AbortController | null]>([null, null]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of aborts.current) controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!props.models.some((model) => model.value === leftKey)) setLeftKey(props.models[0]?.value ?? '');
    if (!props.models.some((model) => model.value === rightKey)) setRightKey(props.models[1]?.value ?? props.models[0]?.value ?? '');
  }, [props.models, leftKey, rightKey]);

  const running = columns.some((column) => column.status === 'running');

  function patchColumn(index: 0 | 1, patch: Partial<CompareColumn>) {
    setColumns((current) => {
      const next: [CompareColumn, CompareColumn] = [{ ...current[0] }, { ...current[1] }];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function cancelColumn(index: 0 | 1) {
    aborts.current[index]?.abort();
  }

  async function runColumn(index: 0 | 1, modelKey: string, turns: ChatTurn[], conversationId: string, assistantId: string) {
    const controller = new AbortController();
    aborts.current[index] = controller;
    patchColumn(index, { modelKey, assistantId, content: '', status: 'running', error: '' });
    let streamed = '';
    try {
      const result = await streamRun({
        request: requestFor(modelKey, turns, conversationId, assistantId),
        signal: controller.signal,
        onApproval: (request) => confirmToolPermission(dialogs, request),
        onUserInput: (request) => answerAgentQuestion(dialogs, request),
        onEvent: (event) => {
          if (event.type === 'text-delta') {
            streamed += event.payload.text;
            if (mounted.current) patchColumn(index, { content: streamed });
          }
          if (event.type === 'message-complete' && event.payload.text) {
            streamed = event.payload.text;
            if (mounted.current) patchColumn(index, { content: streamed });
          }
        }
      });
      if (!mounted.current) return;
      const text = result.state.messages.at(-1)?.content ?? streamed;
      if (result.cancelled) {
        patchColumn(index, { content: text, status: 'cancelled', error: 'Cancelled.' });
        return;
      }
      if (result.state.status === 'failed') {
        patchColumn(index, { content: text, status: 'failed', error: result.state.failure?.message ?? 'This run failed.' });
        return;
      }
      patchColumn(index, { content: text, status: 'complete', error: '' });
    } catch (reason) {
      if (!mounted.current) return;
      if (controller.signal.aborted) {
        patchColumn(index, { content: streamed, status: 'cancelled', error: 'Cancelled.' });
        return;
      }
      patchColumn(index, { content: streamed, status: 'failed', error: reason instanceof Error ? reason.message : 'This run failed.' });
    } finally {
      if (aborts.current[index] === controller) aborts.current[index] = null;
    }
  }

  async function compare() {
    if (busy || running) return;
    const text = prompt.trim();
    if (!text) { setError('Enter a prompt to compare.'); return; }
    if (!leftKey || !rightKey) { setError('Choose a model for each column.'); return; }
    setBusy(true);
    setError('');
    for (const controller of aborts.current) controller?.abort();
    aborts.current = [null, null];
    setColumns([emptyColumn(0, leftKey), emptyColumn(1, rightKey)]);
    try {
      const id = crypto.randomUUID();
      await conversations.create(id);
      await conversations.update(id, { title: `Compare · ${text.slice(0, 48)}` }).catch(() => undefined);
      const userId = crypto.randomUUID();
      const leftId = crypto.randomUUID();
      const rightId = crypto.randomUUID();
      const leftModel = parseModelKey(leftKey).model;
      const rightModel = parseModelKey(rightKey).model;
      await conversations.appendMessage({ conversationId: id, id: userId, parentId: null, role: 'user', content: text, complete: true });
      await conversations.appendMessage({ conversationId: id, id: leftId, parentId: userId, role: 'assistant', content: '', complete: false, modelId: leftModel, modelIndex: 0 });
      await conversations.appendMessage({ conversationId: id, id: rightId, parentId: userId, role: 'assistant', content: '', complete: false, modelId: rightModel, modelIndex: 1 });
      setConversationId(id);
      const turns: ChatTurn[] = [{ role: 'user', content: text }];
      await Promise.all([
        runColumn(0, leftKey, turns, id, leftId),
        runColumn(1, rightKey, turns, id, rightId)
      ]);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'The comparison could not start.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const modelOptions = props.models.length
    ? props.models
    : [{ value: '', label: 'No chat models available', icon: connectionIcon('local-replay') }];

  return <section className="model-compare" aria-label="Model comparison">
    <Card className="model-compare-panel">
      <p className="model-compare-hint">Two independent Copilot runs on the same prompt. Each column can fail or cancel on its own.</p>
      <div className="model-compare-models">
        <label>Left model
          <SelectField aria-label="Left comparison model" value={leftKey} disabled={busy || running} onValueChange={setLeftKey}>
            <option value="">Choose a model</option>
            {modelOptions.map((model) => <option key={`left-${model.value}`} value={model.value}>{model.label}</option>)}
          </SelectField>
        </label>
        <label>Right model
          <SelectField aria-label="Right comparison model" value={rightKey} disabled={busy || running} onValueChange={setRightKey}>
            <option value="">Choose a model</option>
            {modelOptions.map((model) => <option key={`right-${model.value}`} value={model.value}>{model.label}</option>)}
          </SelectField>
        </label>
      </div>
      <label>Prompt
        <TextArea value={prompt} disabled={busy || running} maxLength={20_000} placeholder="Ask both models the same question" onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <Separator />
      <Card.Footer className="model-compare-actions">
        <Button size="sm" isDisabled={busy || running || !leftKey || !rightKey} onPress={() => void compare()}>{busy && !running ? 'Preparing…' : 'Compare'}</Button>
        {conversationId && props.onOpenConversation && <Button variant="secondary" size="sm" onPress={() => props.onOpenConversation?.(conversationId)}>Open in chat</Button>}
      </Card.Footer>
    </Card>
    {error && <p className="sidebar-error" role="alert">{error}</p>}
    <div className="model-compare-columns">
      {columns.map((column, index) => {
        const label = props.models.find((model) => model.value === column.modelKey)?.label ?? column.modelKey ?? (index === 0 ? 'Left' : 'Right');
        return <article key={column.modelIndex} className="model-compare-column thread-message thread-message-assistant" data-model-index={column.modelIndex} aria-label={`${label} result`}>
          <div className="message-header">
            <span className="message-label">{label || `Column ${column.modelIndex + 1}`}</span>
            <span className="model-compare-status" role="status">{column.status === 'running' ? 'Streaming…' : column.status === 'complete' ? 'Complete' : column.status === 'cancelled' ? 'Cancelled' : column.status === 'failed' ? 'Failed' : 'Waiting'}</span>
          </div>
          {column.content
            ? <div className="prose"><Streamdown components={MARKDOWN_COMPONENTS} parseIncompleteMarkdown controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{column.content}</Streamdown></div>
            : column.status === 'running' ? <p className="model-compare-hint">Waiting for the first tokens…</p> : <p className="model-compare-hint">Result appears here after Compare.</p>}
          {column.error && <p role="alert" className="thread-message-error">{column.error}</p>}
          {column.status === 'running' && <div className="model-compare-actions"><Button variant="tertiary" size="sm" onPress={() => cancelColumn(index as 0 | 1)}>Cancel</Button></div>}
        </article>;
      })}
    </div>
  </section>;
}
