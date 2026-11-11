const BUILTIN_TOOLS: Record<string, { name: string; description: string }> = {
  'builtin:view': { name: 'Read files', description: 'Read Library or connected-folder text files.' },
  'builtin:create': { name: 'Create files', description: 'Create a new text file under the Library or a connected folder.' },
  'builtin:edit': { name: 'Edit files', description: 'Replace one exact string in a Library or connected-folder file.' },
  'builtin:delete': { name: 'Delete files', description: 'Delete a Library or connected-folder file.' },
  'builtin:move': { name: 'Move files', description: 'Move or rename a Library or connected-folder file.' },
  'builtin:glob': { name: 'Find files', description: 'Find files by glob pattern.' },
  'builtin:grep': { name: 'Search files', description: 'Search file contents under the Library or a connected folder.' },
  'builtin:apply-markdown-note': { name: 'Apply note markdown', description: 'Apply Markdown onto a Library note pair.' },
  'builtin:open-path': { name: 'Open path', description: 'Open a Library or connected-folder file on the stage.' },
  'builtin:open-in-code': { name: 'Open in Code', description: 'Open a connected-folder file in Code. Library files open on the stage.' },
  'builtin:knowledge-search': { name: 'Search knowledge', description: 'Search indexed knowledge collections.' },
  'builtin:calendar-list': { name: 'List calendar', description: 'List upcoming calendar events.' },
  'builtin:todo-write': { name: 'Update tasks', description: 'Merge an in-turn task checklist.' },
  'builtin:schedule-run': { name: 'Run schedule', description: 'Run an automation by path.' },
  'builtin:action-run': { name: 'Run action', description: 'Run an Action file against source material.' },
  'builtin:memory-search': { name: 'Search memory', description: 'Find relevant saved facts.' },
  'builtin:memory-remember': { name: 'Save to memory', description: 'Remember a fact for future conversations.' },
  'builtin:memory-update': { name: 'Update memory', description: 'Replace a saved fact by id.' },
  'builtin:memory-forget': { name: 'Forget memory', description: 'Delete a saved fact by id.' },
  'builtin:generate-image': { name: 'Generate images', description: 'Create images with a supported provider.' },
  'builtin:run-code': { name: 'Run code', description: 'Run JavaScript in the local sandbox.' },
  'builtin:web-search': { name: 'Web search', description: 'Search the public web.' },
  'builtin:web-fetch': { name: 'Opened page', description: 'Open a public web page and return its text.' },
};

/** First-party Copilot and snake_case tool names the chat surface may receive. */
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web search',
  web_fetch: 'Opened page',
  fetch_url: 'Opened page',
  ask_user: 'Question',
  schedule_run: 'Run schedule',
  action_run: 'Run action',
  apply_markdown_note: 'Apply note markdown',
  knowledge_search: 'Search knowledge',
  calendar_list: 'List calendar',
  open_path: 'Open path',
  open_in_code: 'Open in Code',
  todo_write: 'Updated tasks',
  memory_search: 'Search memory',
  memory_remember: 'Save to memory',
  memory_update: 'Update memory',
  memory_forget: 'Forget memory',
  generate_image: 'Generate images',
  run_code: 'Run code',
  view: 'Read',
  glob: 'Find files',
  grep: 'Search files',
  bash: 'Ran',
  edit: 'Edited',
  create: 'Created',
  delete: 'Deleted',
  move: 'Moved',
  create_file: 'Created',
  apply_patch: 'Patched',
  skill: 'Skill',
  task: 'Task',
};

/** Short activity verbs for in-thread tool rows (past when done, progressive while running). */
const THREAD_ACTIVITY_LABELS: Record<string, { done: string; running: string }> = {
  view: { done: 'Read', running: 'Reading' },
  create: { done: 'Created', running: 'Creating' },
  create_file: { done: 'Created', running: 'Creating' },
  edit: { done: 'Edited', running: 'Editing' },
  delete: { done: 'Deleted', running: 'Deleting' },
  move: { done: 'Moved', running: 'Moving' },
  glob: { done: 'Found files', running: 'Finding files' },
  grep: { done: 'Searched', running: 'Searching' },
  apply_markdown_note: { done: 'Applied note', running: 'Applying note' },
  open_path: { done: 'Opened', running: 'Opening' },
  open_in_code: { done: 'Opened in Code', running: 'Opening in Code' },
  knowledge_search: { done: 'Searched knowledge', running: 'Searching knowledge' },
  calendar_list: { done: 'Listed calendar', running: 'Listing calendar' },
  todo_write: { done: 'Updated tasks', running: 'Working…' },
  web_fetch: { done: 'Opened page', running: 'Opening page' },
  write: { done: 'Wrote', running: 'Writing' },
  write_file: { done: 'Wrote', running: 'Writing' },
  apply_patch: { done: 'Patched', running: 'Patching' },
  bash: { done: 'Ran', running: 'Running' },
};

function humanizeIdentifier(value: string): string {
  return value
    .replace(/^builtin:/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export function toolPresentation(tool: { id: string; name: string; description: string }) {
  const description = tool.description.split(/(?<=[.!?])\s/)[0]?.trim() ?? '';
  // Catalog rows keep their connection-facing names. Copilot activity labels
  // (Wrote, Ran, …) belong only on in-thread tool rows via toolDisplayName.
  return {
    name: BUILTIN_TOOLS[tool.id]?.name ?? humanizeIdentifier(tool.name || tool.id),
    description: BUILTIN_TOOLS[tool.id]?.description ?? (description.length <= 160 ? description : ''),
  };
}

/** End-user label for a tool id or runtime name. */
export function toolDisplayName(idOrName: string): string {
  if (BUILTIN_TOOLS[idOrName]) return BUILTIN_TOOLS[idOrName]!.name;
  if (TOOL_LABELS[idOrName]) return TOOL_LABELS[idOrName]!;
  const bare = idOrName.replace(/^builtin:/, '');
  if (TOOL_LABELS[bare]) return TOOL_LABELS[bare]!;
  return humanizeIdentifier(idOrName);
}

export function toolThreadActivity(idOrName: string): { done: string; running: string } {
  const bare = idOrName.replace(/^builtin:/, '');
  return THREAD_ACTIVITY_LABELS[bare] ?? THREAD_ACTIVITY_LABELS[idOrName] ?? {
    done: toolDisplayName(idOrName),
    running: toolDisplayName(idOrName),
  };
}

/** In-thread activity label for a tool call row. */
export function toolActivityLabel(idOrName: string, running = false): string {
  const activity = toolThreadActivity(idOrName);
  return running ? activity.running : activity.done;
}

/** Stable catalog order: name, then id. */
export function sortTools<T extends { id: string; name: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
