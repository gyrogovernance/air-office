/**
 * Render-only toolkit for AIR service tools. Execution stays on the service;
 * this file only attaches Elements renders per assistant-ui Tool UI docs
 * (defineToolkit + Tools({ toolkit }) via AuiConfig).
 */
import { useState } from 'react';
import { AuiConfig, Tools, defineToolkit, type ToolCallMessagePartProps } from '@assistant-ui/react';
import { TodoList, type TodoItem, type TodoStatus } from '@/components/assistant-ui/elements/todo-list';
import { WebSearch } from '@/components/assistant-ui/elements/web-search';
import { LinkPreview } from '@/components/assistant-ui/elements/link-preview';
import { MemoryChips } from '@/components/assistant-ui/elements/memory-chips';
import { ImageGeneration } from '@/components/assistant-ui/elements/image-generation';
import { DataTable } from '@/components/assistant-ui/elements/data-table';
import { RetrievalChunks } from '@/components/assistant-ui/elements/retrieval-chunks';
import { DocumentReference } from '@/components/assistant-ui/elements/document-reference';
import { CodeRunner } from '@/components/assistant-ui/elements/code-runner';
import { TerminalBlock } from '@/components/assistant-ui/elements/terminal-block';
import { ScheduleCard } from '@/components/assistant-ui/elements/schedule-card';
import { TaskCard } from '@/components/assistant-ui/elements/task-card';
import { FileTree } from '@/components/assistant-ui/elements/file-tree';
import { ReviewableDiff } from '@/components/assistant-ui/elements/reviewable-diff';
import { Sources } from '@/components/assistant-ui/elements/sources';
import type { DiffLine } from '@/components/assistant-ui/elements/code-diff';
import { airWidgetFrame } from './chat-generative-frame.composition';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function mapTodoStatus(status: unknown): TodoStatus {
  if (status === 'in_progress') return 'active';
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function todosFrom(args: unknown, result: unknown): TodoItem[] {
  const source = asRecord(result).todos ?? asRecord(args).todos;
  if (!Array.isArray(source)) return [];
  return source.flatMap((entry, index) => {
    const row = asRecord(entry);
    const id = typeof row.id === 'string' ? row.id : `todo-${index}`;
    const text = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : '';
    if (!text) return [];
    return [{ id, text, status: mapTodoStatus(row.status) }];
  });
}

function leafName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.at(-1) || path;
}

function linesFromDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((text) => {
    if (text.startsWith('+') && !text.startsWith('+++')) return { kind: 'added' as const, text: text.slice(1) };
    if (text.startsWith('-') && !text.startsWith('---')) return { kind: 'removed' as const, text: text.slice(1) };
    return { kind: 'context' as const, text: text.startsWith(' ') ? text.slice(1) : text };
  });
}

function WebSearchSources({ sources }: { sources: { title: string; url?: string; domain?: string; snippet?: string }[] }) {
  const [open, setOpen] = useState(true);
  if (!sources.length) return null;
  return <Sources sources={sources} open={open} onOpenChange={setOpen} layout="list" />;
}

type ToolProps = ToolCallMessagePartProps;

/** Inline with the tool group so Tasks sit under the call, not beside an empty “1 tool call” stub. */
const backend = { type: 'backend' as const };

function renderTodoWrite({ args, result, status }: ToolProps) {
  const items = todosFrom(args, result);
  if (!items.length && status.type === 'running') {
    return <TodoList className="w-full max-w-none" title="Tasks" items={[{ id: 'streaming', text: 'Updating tasks…', status: 'active' }]} />;
  }
  if (!items.length) return null;
  return <TodoList className="w-full max-w-none" title="Tasks" items={items} />;
}

function renderWebSearch({ args, result, status }: ToolProps) {
  const record = asRecord(result);
  const query = typeof asRecord(args).query === 'string' ? (asRecord(args).query as string) : '';
  const pages = Array.isArray(record.results) ? record.results : Array.isArray(record.pages) ? record.pages : [];
  const results = pages.map((page) => {
    const row = asRecord(page);
    const title = typeof row.title === 'string' ? row.title : 'Result';
    const url = typeof row.url === 'string' ? row.url : '';
    let domain = typeof row.domain === 'string' ? row.domain : '';
    if (!domain && url) {
      try { domain = new URL(url).hostname; } catch { domain = url; }
    }
    return { title, domain: domain || 'web' };
  });
  const sourceRows = pages.map((page) => {
    const row = asRecord(page);
    const url = typeof row.url === 'string' ? row.url : undefined;
    let domain = typeof row.domain === 'string' ? row.domain : undefined;
    if (!domain && url) {
      try { domain = new URL(url).hostname; } catch { /* keep empty */ }
    }
    return {
      title: typeof row.title === 'string' ? row.title : 'Result',
      url,
      domain,
      snippet: typeof row.snippet === 'string' ? row.snippet : typeof row.text === 'string' ? row.text.slice(0, 160) : undefined,
    };
  });
  return (
    <div className="flex w-full flex-col gap-2">
      <WebSearch
        query={query || 'Search'}
        results={results}
        visibleResults={Math.min(Math.max(results.length, 1), 5)}
        searching={status.type === 'running'}
        cycle={0}
      />
      {status.type !== 'running' && <WebSearchSources sources={sourceRows} />}
    </div>
  );
}

function renderWebFetch({ args, result }: ToolProps) {
  const record = { ...asRecord(args), ...asRecord(result) };
  const url = typeof record.url === 'string' ? record.url : '';
  if (!url) return null;
  return (
    <LinkPreview
      href={url}
      title={typeof record.title === 'string' ? record.title : undefined}
      description={typeof record.text === 'string' ? record.text.slice(0, 160) : undefined}
      layout="compact"
    />
  );
}

function renderKnowledgeSearch({ args, result, status }: ToolProps) {
  const query = typeof asRecord(args).query === 'string' ? (asRecord(args).query as string) : 'Knowledge';
  const hits = Array.isArray(asRecord(result).hits)
    ? asRecord(result).hits as unknown[]
    : Array.isArray(asRecord(result).results)
      ? asRecord(result).results as unknown[]
      : [];
  const chunks = hits.map((hit, index) => {
    const row = asRecord(hit);
    const path = typeof row.path === 'string' ? row.path : typeof row.collectionId === 'string' ? row.collectionId : 'source';
    return {
      id: typeof row.sourceVersionId === 'string' ? row.sourceVersionId : `hit-${index}`,
      source: path,
      locator: typeof row.path === 'string' ? row.path : `hit ${index + 1}`,
      score: typeof row.score === 'number' ? row.score : 0,
      text: typeof row.text === 'string' ? row.text : '',
    };
  }).filter((chunk) => chunk.text);
  return (
    <RetrievalChunks
      query={query}
      chunks={chunks}
      visibleCount={Math.min(Math.max(chunks.length, 1), 5)}
      searching={status.type === 'running'}
    />
  );
}

function renderMemorySearch({ result }: ToolProps) {
  const facts = Array.isArray(asRecord(result).facts)
    ? asRecord(result).facts as unknown[]
    : Array.isArray(asRecord(result).results)
      ? asRecord(result).results as unknown[]
      : [];
  const chips = facts.map((fact, index) => {
    const row = asRecord(fact);
    const text = typeof row.content === 'string' ? row.content : '';
    return { id: typeof row.id === 'string' ? row.id : `memory-${index}`, text, change: 'existing' as const };
  }).filter((chip) => chip.text);
  if (!chips.length) return null;
  return <MemoryChips chips={chips} />;
}

function renderMemoryRemember({ args, result }: ToolProps) {
  const content = typeof asRecord(result).content === 'string'
    ? (asRecord(result).content as string)
    : typeof asRecord(args).content === 'string'
      ? (asRecord(args).content as string)
      : '';
  if (!content) return null;
  return <MemoryChips chips={[{ id: 'remembered', text: content, change: 'added' }]} />;
}

function renderGenerateImage({ args, status }: ToolProps) {
  const prompt = typeof asRecord(args).prompt === 'string' ? (asRecord(args).prompt as string) : 'Image';
  return <ImageGeneration prompt={prompt} generating={status.type === 'running'} />;
}

function renderCalendarList({ result }: ToolProps) {
  const events = Array.isArray(asRecord(result).events) ? asRecord(result).events as unknown[] : [];
  if (!events.length) return null;
  return (
    <DataTable
      caption="Upcoming events"
      columns={[
        { id: 'title', header: 'Event', format: { kind: 'text' } },
        { id: 'start', header: 'Starts', format: { kind: 'text' } },
        { id: 'path', header: 'Calendar', format: { kind: 'text' } },
      ]}
      rows={events.map((event, index) => {
        const row = asRecord(event);
        return {
          id: typeof row.path === 'string' ? `${row.path}-${index}` : `event-${index}`,
          title: typeof row.title === 'string' ? row.title : 'Event',
          start: typeof row.start === 'string' ? row.start : '',
          path: typeof row.path === 'string' ? row.path : '',
        };
      })}
      rowKey="id"
    />
  );
}

function renderOpenPath({ args, result }: ToolProps) {
  const path = typeof asRecord(result).path === 'string'
    ? (asRecord(result).path as string)
    : typeof asRecord(args).path === 'string'
      ? (asRecord(args).path as string)
      : '';
  if (!path) return null;
  return (
    <DocumentReference
      title={leafName(path)}
      pages={1}
      anchors={[{ page: 1, quote: path }]}
      activePage={1}
    />
  );
}

function renderRunCode({ args, result, status }: ToolProps) {
  const code = typeof asRecord(args).code === 'string' ? (asRecord(args).code as string) : '';
  const language = typeof asRecord(args).language === 'string' ? (asRecord(args).language as string) : 'javascript';
  const outputText = typeof asRecord(result).output === 'string'
    ? (asRecord(result).output as string)
    : typeof asRecord(result).stdout === 'string'
      ? (asRecord(result).stdout as string)
      : '';
  const state = status.type === 'running' ? 'running' : status.type === 'incomplete' ? 'error' : outputText ? 'ok' : 'idle';
  return (
    <CodeRunner
      language={language}
      code={code}
      state={state}
      output={outputText ? outputText.split('\n') : []}
    />
  );
}

function renderScheduleRun({ args, result }: ToolProps) {
  const path = typeof asRecord(result).path === 'string'
    ? (asRecord(result).path as string)
    : typeof asRecord(args).path === 'string'
      ? (asRecord(args).path as string)
      : 'Schedule';
  return (
    <ScheduleCard
      name={leafName(path)}
      cadence="Run once"
      nextRun="Just now"
      enabled
      history={[{ id: '1', at: new Date().toISOString(), ok: true }]}
    />
  );
}

function renderActionRun({ args, result, status }: ToolProps) {
  const path = typeof asRecord(args).path === 'string' ? (asRecord(args).path as string) : 'Action';
  const summary = typeof asRecord(result).summary === 'string'
    ? (asRecord(result).summary as string)
    : typeof asRecord(result).text === 'string'
      ? (asRecord(result).text as string)
      : undefined;
  return (
    <TaskCard
      label={leafName(path)}
      state={status.type === 'running' ? 'working' : status.type === 'incomplete' ? 'failed' : 'done'}
      result={summary}
    />
  );
}

function renderShell({ args, result, status }: ToolProps) {
  const command = typeof asRecord(args).command === 'string'
    ? (asRecord(args).command as string)
    : typeof asRecord(args).cmd === 'string'
      ? (asRecord(args).cmd as string)
      : 'command';
  const output = typeof asRecord(result).output === 'string'
    ? (asRecord(result).output as string)
    : typeof asRecord(result).stdout === 'string'
      ? (asRecord(result).stdout as string)
      : '';
  const lines = output ? output.split('\n') : status.type === 'running' ? ['…'] : [];
  return (
    <TerminalBlock
      command={command}
      lines={lines}
      visibleCount={Math.min(Math.max(lines.length, 1), 20)}
      done={status.type !== 'running'}
    />
  );
}

function renderCreate({ args, result }: ToolProps) {
  const path = typeof asRecord(result).path === 'string'
    ? (asRecord(result).path as string)
    : typeof asRecord(args).path === 'string'
      ? (asRecord(args).path as string)
      : typeof asRecord(args).fileName === 'string'
        ? (asRecord(args).fileName as string)
        : '';
  if (!path) return null;
  return (
    <FileTree
      nodes={[{ path, name: leafName(path), depth: 0, kind: 'file', additions: 1, deletions: 0 }]}
      visibleCount={1}
      totalAdditions={1}
      totalDeletions={0}
    />
  );
}

function renderWrite({ args, result }: ToolProps) {
  const record = { ...asRecord(args), ...asRecord(result) };
  const path = typeof record.path === 'string'
    ? record.path
    : typeof record.fileName === 'string'
      ? record.fileName
      : 'file';
  let diff = typeof record.diff === 'string' ? record.diff : '';
  /* Service `edit` sends old_str/new_str rather than a unified diff. */
  if (!diff && typeof record.old_str === 'string' && typeof record.new_str === 'string') {
    const removed = record.old_str.split('\n').map((line) => `- ${line}`).join('\n');
    const added = record.new_str.split('\n').map((line) => `+ ${line}`).join('\n');
    diff = `${removed}\n${added}`;
  }
  if (diff) {
    return (
      <ReviewableDiff
        filename={leafName(path)}
        hunks={[{ id: '1', range: '', decision: 'kept', lines: linesFromDiff(diff) }]}
      />
    );
  }
  return (
    <FileTree
      nodes={[{ path, name: leafName(path), depth: 0, kind: 'file', additions: 1, deletions: 0 }]}
      visibleCount={1}
      totalAdditions={1}
      totalDeletions={0}
    />
  );
}

/** AIR builtins as a render-only backend toolkit (service owns execute). */
export const airChatToolkit = defineToolkit({
  todo_write: { ...backend, render: renderTodoWrite },
  web_search: { ...backend, render: renderWebSearch },
  web_fetch: { ...backend, render: renderWebFetch },
  knowledge_search: { ...backend, render: renderKnowledgeSearch },
  memory_search: { ...backend, render: renderMemorySearch },
  memory_remember: { ...backend, render: renderMemoryRemember },
  generate_image: { ...backend, render: renderGenerateImage },
  calendar_list: { ...backend, render: renderCalendarList },
  open_path: { ...backend, render: renderOpenPath },
  open_in_code: { ...backend, render: renderOpenPath },
  run_code: { ...backend, render: renderRunCode },
  schedule_run: { ...backend, render: renderScheduleRun },
  action_run: { ...backend, render: renderActionRun },
  run_command: { ...backend, render: renderShell },
  /* Agent/shell names used in chat; same terminal plate as run_command. */
  powershell: { ...backend, render: renderShell },
  bash: { ...backend, render: renderShell },
  create: { ...backend, render: renderCreate },
  write: { ...backend, render: renderWrite },
  /* Service exposes `edit` (not `write`); keep both so the diff/file UI mounts. */
  edit: { ...backend, render: renderWrite },
  apply_markdown_note: { ...backend, render: renderWrite },
  ...airWidgetFrame.toolkit,
});

/** Stable config for AssistantRuntimeProvider (docs: hoist AuiConfig). */
export const airChatAuiConfig = AuiConfig({
  tools: Tools({ toolkit: airChatToolkit }),
});
