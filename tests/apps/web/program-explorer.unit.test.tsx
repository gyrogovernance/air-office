import { afterAll, expect, spyOn, test } from 'bun:test';
import type { ComponentProps } from 'react';
import type { WorkspaceNode } from '@office/workspace/domain';
import type { ConversationSummary } from '@office/chat/domain';
import type { ConnectedRoot, FilesystemEntry } from '@office/files/domain';
import '../../support/web-dom.adapter';


const { act, createRef, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ProgramExplorer } = await import('../../../apps/web/src/shared/program-explorer.component');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');
const { createServiceClient } = await import('../../../apps/web/src/shared/service-client.hook');

function chat(id: string, title: string): ConversationSummary {
  return { id, title, updatedAt: '2026-10-14T12:00:00Z', messageCount: 1, pinned: false, archivedAt: null, tags: [], folderId: null, unreadAt: null };
}

test('deleting a selected and focused recent chat keeps the explorer and workspace rendered', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes: [] });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div');
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  const client = createServiceClient();
  const props: ComponentProps<typeof ProgramExplorer> = {
    client, notes: [], chats: [chat('delete', 'Chat to delete'), chat('keep', 'Remaining chat')], importedFiles: [], activeNoteId: null, activeChatId: null, sending: false,
    onOpenNote() {}, onOpenChat() {}, async onOpenFile() {}, onOpenImport() {},
    async onCreateNote(title) { return { id: 'new-note', title }; }, async onRenameNote() {}, async onCloneNote() { return { id: 'clone', title: 'Clone' }; },
    async onCreateChat() { return 'new-chat'; }, async onChatAction() {}, async onRenameChat() {}, async onChanged() {}, onDiskMutation() {}, async onSearch() { return []; }
  };
  const render = (chats: ConversationSummary[]) => <StrictMode><AppDialogsProvider><main aria-label="Workspace document">Preserved document</main><ProgramExplorer {...props} chats={chats}/></AppDialogsProvider></StrictMode>;
  props.onChanged = async () => { root.render(render(props.chats.map((item) => ({ ...item })))); };
  try {
    localStorage.clear();
    await act(async () => { root.render(render(props.chats)); });
    const removed = host.querySelector<HTMLElement>('[role="treeitem"][title="Chat to delete"]');
    expect(removed).not.toBeNull();
    await act(async () => {
      removed?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      removed?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      removed?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      removed?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      removed?.click();
    });
    expect(removed?.getAttribute('aria-selected')).toBe('true');
    expect(removed?.classList.contains('is-focused')).toBe(true);
    await act(async () => { removed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', bubbles: true })); removed?.dispatchEvent(new KeyboardEvent('keyup', { key: 'F2', code: 'F2', bubbles: true })); });
    expect(host.querySelector('[aria-label="Rename Chat to delete"]')).not.toBeNull();
    await act(async () => { host.querySelector('[aria-label="Rename Chat to delete"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); host.querySelector('[aria-label="Rename Chat to delete"]')?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true })); });
    expect(host.querySelector('[aria-label="Rename Chat to delete"]')).toBeNull();
    await act(async () => {
      removed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true }));
      removed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true, bubbles: true }));
      removed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, bubbles: true }));
      removed?.dispatchEvent(new KeyboardEvent('keyup', { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, bubbles: true }));
      removed?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, bubbles: true }));
      removed?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
    });
    expect(host.querySelector('[aria-live="assertive"]')?.textContent).toContain('Dragging Chat to delete');
    await act(async () => { removed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); removed?.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true })); });
    await act(async () => { root.render(render([chat('keep', 'Remaining chat')])); });
    expect(errors).toEqual([]);
    expect(host.querySelector('[role="treeitem"][title="Chat to delete"]')).toBeNull();
    expect(host.querySelector('[role="treeitem"][title="Remaining chat"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Workspace document"]')?.textContent).toBe('Preserved document');
    expect(host.querySelector('[role="tree"][aria-label="Library files"]')).not.toBeNull();
    // The tree filter lives in the Search tab; typing there narrows to matching items.
    const searchTab = host.querySelectorAll<HTMLButtonElement>('.workspace-action-scene [role="tab"], [role="tab"]').length
      ? [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === 'Search')
      : undefined;
    if (!searchTab) throw new Error('The search tab must remain available.');
    await act(async () => { searchTab.click(); });
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search library"]');
    if (!search) throw new Error('The search input must appear in the Search tab.');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setValue) throw new Error('The DOM input must support user input.');
    await act(async () => { setValue.call(search, 'No matching chat'); search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.querySelector('[role="treeitem"][title="Remaining chat"]')).toBeNull();
    await act(async () => { setValue.call(search, ''); search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.querySelector('[role="treeitem"][title="Remaining chat"]')).not.toBeNull();
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('refreshing a deleted selected catalog folder removes its stale row without losing recent chats', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  let nodes: WorkspaceNode[] = [{ id: 'program', kind: 'program', parentId: null, name: 'Program', instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp }, { id: 'folder', kind: 'folder', parentId: 'program', name: 'Folder to delete', instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp }];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const controls = createRef<import('../../../apps/web/src/shared/program-explorer.component').ProgramExplorerControls>();
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(<AppDialogsProvider><ProgramExplorer client={createServiceClient()} controlsRef={controls} notes={[]} chats={[chat('keep', 'Remaining chat')]} importedFiles={[]} activeNoteId={null} activeChatId={null} sending={false} onOpenNote={() => undefined} onOpenChat={() => undefined} onOpenFile={async () => undefined} onOpenImport={() => undefined} onCreateNote={async (title) => ({ id: 'new', title })} onRenameNote={async () => undefined} onCloneNote={async () => ({ id: 'clone', title: 'Clone' })} onCreateChat={async () => 'new'} onChatAction={async () => undefined} onRenameChat={async () => undefined} onChanged={async () => undefined} onDiskMutation={() => undefined} onSearch={async () => []}/></AppDialogsProvider>); });
    const removed = host.querySelector<HTMLElement>('[role="treeitem"][title="Folder to delete"]');
    expect(removed).not.toBeNull();
    await act(async () => { removed?.focus(); removed?.click(); });
    nodes = nodes.filter((node) => node.id !== 'folder');
    await act(async () => { await controls.current?.refresh(); });
    expect(errors).toEqual([]);
    expect(host.querySelector('[title="Folder to delete"]')).toBeNull();
    expect(host.querySelector('[role="treeitem"][title="Program"]')).not.toBeNull();
    expect(host.querySelector('[role="treeitem"][title="Remaining chat"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('pointer dragging a recent chat into a Program sends organization and retains its recent entry', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const nodes: WorkspaceNode[] = [{ id: 'program', kind: 'program', parentId: null, name: 'Research program', instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp }];
  let chats = [chat('move-chat', 'Chat to organize')];
  const operations: unknown[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    if (path === '/api/v1/workspace/organize') {
      if (typeof init?.body !== 'string') throw new Error('Expected an organization request body.');
      operations.push(JSON.parse(init.body));
      chats = chats.map((entry) => ({ ...entry, folderId: 'program' }));
      return Response.json({ nodes });
    }
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const client = createServiceClient();
  const props: ComponentProps<typeof ProgramExplorer> = {
    client, notes: [], chats, importedFiles: [], activeNoteId: null, activeChatId: null, sending: false,
    onOpenNote() {}, onOpenChat() {}, async onOpenFile() {}, onOpenImport() {},
    async onCreateNote(title) { return { id: 'new-note', title }; }, async onRenameNote() {}, async onCloneNote() { return { id: 'clone', title: 'Clone' }; },
    async onCreateChat() { return 'new-chat'; }, async onChatAction() {}, async onRenameChat() {}, async onChanged() { root.render(render()); }, onDiskMutation() {}, async onSearch() { return []; }
  };
  const render = () => <StrictMode><AppDialogsProvider><ProgramExplorer {...props} chats={chats}/></AppDialogsProvider></StrictMode>;
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(render()); });
    const source = host.querySelector<HTMLElement>('[role="treeitem"][title="Chat to organize"]');
    const destination = host.querySelector<HTMLElement>('[role="treeitem"][title="Research program"]');
    if (!source || !destination) throw new Error('Expected the recent chat and target Program to be displayed.');
    await act(async () => source.click());
    const geometry = spyOn(destination, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 30));
    const transfer = new DataTransfer();
    await act(async () => { source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })); });
    await act(async () => {
      destination.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 }));
      destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 }));
    });
    await act(async () => { destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 })); });
    geometry.mockRestore();
    expect(operations).toEqual([{ ids: [], chatIds: ['move-chat'], notes: [], parentId: 'program', beforeId: null }]);
    // Chats live in one place: the chat moved under its program's collection.
    expect(host.querySelectorAll('[role="treeitem"][title="Chat to organize"]')).toHaveLength(1);
    expect(host.querySelector('[role="treeitem"][title="Research program"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('overflow menu actions do not open their chat or collapse their parent folder', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const nodes: WorkspaceNode[] = [{ id: 'program', kind: 'program', parentId: null, name: 'Research program', instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp }];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const opens: string[] = [];
  const actions: { id: string; action: string }[] = [];
  const props: ComponentProps<typeof ProgramExplorer> = {
    client: createServiceClient(), notes: [], chats: [chat('menu-chat', 'Chat menu')], importedFiles: [], activeNoteId: null, activeChatId: null, sending: false,
    onOpenNote() {}, onOpenChat(id) { opens.push(id); }, async onOpenFile() {}, onOpenImport() {},
    async onCreateNote(title) { return { id: 'new-note', title }; }, async onRenameNote() {}, async onCloneNote() { return { id: 'clone', title: 'Clone' }; },
    async onCreateChat() { return 'new-chat'; }, async onChatAction(id, action) { actions.push({ id, action }); }, async onRenameChat() {}, async onChanged() {}, onDiskMutation() {}, async onSearch() { return []; }
  };
  const menuItem = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === label);
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(<StrictMode><AppDialogsProvider><ProgramExplorer {...props}/></AppDialogsProvider></StrictMode>); });
    await act(async () => { host.querySelector<HTMLElement>('[aria-label="Options for Chat menu"]')?.click(); });
    expect(menuItem('Pin')).not.toBeUndefined();
    await act(async () => { menuItem('Pin')?.click(); });
    expect(actions).toEqual([{ id: 'menu-chat', action: 'pin' }]);
    expect(opens).toEqual([]);
    await act(async () => { host.querySelector<HTMLElement>('[aria-label="Options for Chat menu"]')?.click(); });
    expect(menuItem('Cut')).not.toBeUndefined();
    await act(async () => { menuItem('Cut')?.click(); });
    expect(host.textContent).toContain('1 item ready to move');
    expect(opens).toEqual([]);
    await act(async () => { host.querySelector<HTMLElement>('[aria-label="Options for Research program"]')?.click(); });
    expect(menuItem('New folder')).not.toBeUndefined();
    await act(async () => { menuItem('New folder')?.click(); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New folder');
    expect(host.querySelector('[role="treeitem"][title="Research program"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('note disclosure expands and collapses nested notes without opening the parent document', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const base = { instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp };
  const nodes: WorkspaceNode[] = [
    { ...base, id: 'program', kind: 'program', parentId: null, name: 'Program' },
    { ...base, id: 'parent', kind: 'note', parentId: 'program', targetId: 'doc-parent', name: 'Parent note' },
    { ...base, id: 'child', kind: 'note', parentId: 'parent', targetId: 'doc-child', name: 'Child note' }
  ];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  const opened: string[] = [];
  const props: ComponentProps<typeof ProgramExplorer> = {
    client: createServiceClient(), notes: [{ id: 'doc-parent', title: 'Parent note' }, { id: 'doc-child', title: 'Child note' }], chats: [], importedFiles: [], activeNoteId: null, activeChatId: null, sending: false,
    onOpenNote(id) { opened.push(id); }, onOpenChat() {}, async onOpenFile() {}, onOpenImport() {},
    async onCreateNote(title) { return { id: 'new', title }; }, async onRenameNote() {}, async onCloneNote() { return { id: 'clone', title: 'Clone' }; },
    async onCreateChat() { return 'new-chat'; }, async onChatAction() {}, async onRenameChat() {}, async onChanged() {}, onDiskMutation() {}, async onSearch() { return []; }
  };
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(<StrictMode><AppDialogsProvider><ProgramExplorer {...props}/></AppDialogsProvider></StrictMode>); });
    // Nested note placement renders in the By Location view.
    const locationTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === 'By Location');
    expect(locationTab).not.toBeUndefined();
    await act(async () => { locationTab?.click(); });
    expect(host.querySelector('[role="treeitem"][title="Child note"]')).toBeNull();
    const expand = host.querySelector<HTMLButtonElement>('button[aria-label="Expand Parent note"]');
    expect(expand).not.toBeNull();
    await act(async () => { expand?.click(); });
    expect(host.querySelector('[role="treeitem"][title="Parent note"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="treeitem"][title="Child note"]')).not.toBeNull();
    expect(opened).toEqual([]);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Collapse Parent note"]')?.click(); });
    expect(host.querySelector('[role="treeitem"][title="Parent note"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[role="treeitem"][title="Child note"]')).toBeNull();
    expect(opened).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('connected folders load lazily, report failures with a retry, and accept files but never chats', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const base = { instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp };
  const nodes: WorkspaceNode[] = [
    { ...base, id: 'program', kind: 'program', parentId: null, name: 'Research program' },
    { ...base, id: 'mount', kind: 'mount', parentId: 'program', name: 'Docs', rootId: 'root-1' }
  ];
  const roots: ConnectedRoot[] = [{ id: 'root-1', name: 'Docs', path: 'F:/Docs', connectedAt: timestamp }];
  const entry = (path: string, name: string, kind: 'file' | 'directory'): FilesystemEntry => ({ rootId: 'root-1', path, name, kind, size: 4, modifiedAt: timestamp });
  const sub = entry('sub', 'sub', 'directory');
  const readme = entry('readme.md', 'readme.md', 'file');
  const nested = entry('sub/nested.md', 'nested.md', 'file');
  let subFailures = 1;
  const requests: string[] = [];
  const operations: unknown[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
    if (url.pathname === '/bootstrap') return Response.json({ token: 'test-session' });
    if (url.pathname === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (url.pathname === '/api/v1/external/roots') return Response.json({ roots });
    if (url.pathname === '/api/v1/workspace/organize') {
      if (typeof init?.body !== 'string') throw new Error('Expected an organization request body.');
      operations.push(JSON.parse(init.body));
      return Response.json({ nodes });
    }
    if (url.pathname === '/api/v1/external/children') {
      if (url.searchParams.get('path') === 'sub') {
        if (subFailures > 0) { subFailures -= 1; return Response.json({ error: 'Folder is not available right now.' }, { status: 500 }); }
        return Response.json({ entries: [nested] });
      }
      return Response.json({ entries: [sub, readme] });
    }
    if (url.pathname === '/api/v1/external/upload' && init?.method === 'POST') return Response.json({ entry: readme }, { status: 201 });
    throw new Error(`Unexpected test request ${url.pathname}${url.search}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'node:mount', 'group:chats']));
    await act(async () => { root.render(<AppDialogsProvider><ProgramExplorer client={createServiceClient()} notes={[]} chats={[chat('recent-chat', 'Recent chat')]} importedFiles={[]} activeNoteId={null} activeChatId={null} sending={false} onOpenNote={() => undefined} onOpenChat={() => undefined} onOpenFile={async () => undefined} onOpenImport={() => undefined} onCreateNote={async (title) => ({ id: 'new', title })} onRenameNote={async () => undefined} onCloneNote={async () => ({ id: 'clone', title: 'Clone' })} onCreateChat={async () => 'new'} onChatAction={async () => undefined} onRenameChat={async () => undefined} onChanged={async () => undefined} onDiskMutation={() => undefined} onSearch={async () => []}/></AppDialogsProvider>); });
    await flush();
    expect(host.querySelector('[role="treeitem"][title="Docs"]')?.textContent).toContain('local');
    expect(host.querySelector('[role="treeitem"][title="sub"]')).not.toBeNull();
    expect(host.querySelector('[role="treeitem"][title="readme.md"]')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Expand sub"]')?.click(); });
    await flush();
    const failedRow = host.querySelector<HTMLElement>('[role="treeitem"][title="Folder is not available right now."]');
    expect(failedRow).not.toBeNull();
    expect(failedRow?.querySelector('[aria-label="Folder unavailable"]')).not.toBeNull();
    expect(host.querySelector('[role="treeitem"][title="nested.md"]')).toBeNull();
    await act(async () => { host.querySelector<HTMLElement>('[aria-label="Options for sub"]')?.click(); });
    await act(async () => { Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === 'Refresh folder')?.click(); });
    await flush();
    expect(host.querySelector('[role="treeitem"][title="sub"] [aria-label="Folder unavailable"]')).toBeNull();
    expect(host.querySelector('[role="treeitem"][title="nested.md"]')).not.toBeNull();
    const chatRow = host.querySelector<HTMLElement>('[role="treeitem"][title="Recent chat"]');
    const connected = host.querySelector<HTMLElement>('[role="treeitem"][title="Docs"]');
    if (!chatRow || !connected) throw new Error('Expected the connected folder and the recent chat rows.');
    const drag = (type: string, transfer: DataTransfer) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { dataTransfer: { value: transfer }, clientX: { value: 80 }, clientY: { value: 15 } });
      return event;
    };
    await act(async () => { chatRow.click(); });
    const geometry = spyOn(connected, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 30));
    const transfer = new DataTransfer();
    await act(async () => { chatRow.dispatchEvent(drag('dragstart', transfer)); });
    await act(async () => {
      connected.dispatchEvent(drag('dragenter', transfer));
      connected.dispatchEvent(drag('dragover', transfer));
      connected.dispatchEvent(drag('drop', transfer));
    });
    geometry.mockRestore();
    expect(operations).toEqual([{ ids: [], chatIds: ['recent-chat'], notes: [], parentId: 'program', beforeId: null }]);
    expect(requests.filter((line) => line.includes('upload'))).toEqual([]);
    const files = new DataTransfer();
    files.items.add(new File(['data'], 'dropped.md', { type: 'text/markdown' }));
    Object.defineProperty(files, 'types', { get: () => ['Files', 'text/markdown'] });
    const uploadGeometry = spyOn(connected, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 30));
    await act(async () => {
      connected.dispatchEvent(drag('dragenter', files));
      connected.dispatchEvent(drag('dragover', files));
      connected.dispatchEvent(drag('drop', files));
    });
    uploadGeometry.mockRestore();
    await flush();
    expect(requests.some((line) => line.includes('/api/v1/external/upload') && line.includes('name=dropped.md'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('keyboard drag moves a recent chat into a Program and Enter sends the organization', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const nodes: WorkspaceNode[] = [{ id: 'program', kind: 'program', parentId: null, name: 'Research program', instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp }];
  let chats = [chat('kb-chat', 'Keyboard chat')];
  const operations: unknown[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    if (path === '/api/v1/workspace/organize') {
      if (typeof init?.body !== 'string') throw new Error('Expected an organization request body.');
      operations.push(JSON.parse(init.body));
      chats = chats.map((entry) => ({ ...entry, folderId: 'program' }));
      return Response.json({ nodes });
    }
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  const render = () => <StrictMode><AppDialogsProvider><ProgramExplorer client={createServiceClient()} notes={[]} chats={chats} importedFiles={[]} activeNoteId={null} activeChatId={null} sending={false} onOpenNote={() => undefined} onOpenChat={() => undefined} onOpenFile={async () => undefined} onOpenImport={() => undefined} onCreateNote={async (title) => ({ id: 'new', title })} onRenameNote={async () => undefined} onCloneNote={async () => ({ id: 'clone', title: 'Clone' })} onCreateChat={async () => 'new'} onChatAction={async () => undefined} onRenameChat={async () => undefined} onChanged={async () => { root.render(render()); }} onDiskMutation={() => undefined} onSearch={async () => []}/></AppDialogsProvider></StrictMode>;
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(render()); });
    const row = host.querySelector<HTMLElement>('[role="treeitem"][title="Keyboard chat"]');
    if (!row) throw new Error('Expected the recent chat row.');
    await act(async () => {
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      row.click();
    });
    const press = (init: KeyboardEventInit, up = false) => row.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { bubbles: true, ...init }));
    await act(async () => {
      press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
      press({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
      press({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
      press({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }, true);
      press({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true }, true);
      press({ key: 'Control', code: 'ControlLeft' }, true);
    });
    expect(host.querySelector('[aria-live="assertive"]')?.textContent).toContain('Dragging Keyboard chat');
    for (let step = 0; step < 6 && !(host.querySelector('[aria-live="assertive"]')?.textContent ?? '').includes('in Research program'); step += 1) {
      await act(async () => { press({ key: 'ArrowUp', code: 'ArrowUp' }); press({ key: 'ArrowUp', code: 'ArrowUp' }, true); });
    }
    expect(host.querySelector('[aria-live="assertive"]')?.textContent).toContain('in Research program');
    await act(async () => { press({ key: 'Enter', code: 'Enter' }); press({ key: 'Enter', code: 'Enter' }, true); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(operations).toEqual([{ ids: [], chatIds: ['kb-chat'], notes: [], parentId: 'program', beforeId: null }]);
    expect(host.querySelectorAll('[role="treeitem"][title="Keyboard chat"]')).toHaveLength(1);
    expect(host.querySelector('[role="treeitem"][title="Research program"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});

test('the chat context menu exposes the full action set and nested folder placement files the chat', async () => {
  const timestamp = '2026-10-14T12:00:00Z';
  const base = { instruction: '', order: 0, createdAt: timestamp, updatedAt: timestamp };
  const nodes: WorkspaceNode[] = [
    { ...base, id: 'program', kind: 'program', parentId: null, name: 'Research program' },
    { ...base, id: 'folder', kind: 'folder', parentId: 'program', name: 'Field notes' }
  ];
  let chats = [chat('ctx-chat', 'Chat to file')];
  const operations: unknown[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-session' });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    if (path === '/api/v1/workspace/organize') {
      if (typeof init?.body !== 'string') throw new Error('Expected an organization request body.');
      operations.push(JSON.parse(init.body));
      chats = chats.map((entry) => ({ ...entry, folderId: 'folder' }));
      return Response.json({ nodes });
    }
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div'); document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  const opens: string[] = [];
  const actions: { id: string; action: string }[] = [];
  const render = () => <StrictMode><AppDialogsProvider><ProgramExplorer client={createServiceClient()} notes={[]} chats={chats} importedFiles={[]} activeNoteId={null} activeChatId={null} sending={false} onOpenNote={() => undefined} onOpenChat={(id) => { opens.push(id); }} onOpenFile={async () => undefined} onOpenImport={() => undefined} onCreateNote={async (title) => ({ id: 'new', title })} onRenameNote={async () => undefined} onCloneNote={async () => ({ id: 'clone', title: 'Clone' })} onCreateChat={async () => 'new'} onChatAction={async (id, action) => { actions.push({ id, action }); }} onRenameChat={async () => undefined} onChanged={async () => { root.render(render()); }} onDiskMutation={() => undefined} onSearch={async () => []}/></AppDialogsProvider></StrictMode>;
  const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const menuLabels = () => menuItems().map((item) => item.textContent ?? '');
  try {
    localStorage.setItem('air-office:explorer-expanded', JSON.stringify(['group:programs', 'node:program', 'group:chats']));
    await act(async () => { root.render(render()); });
    const row = host.querySelector<HTMLElement>('[role="treeitem"][title="Chat to file"]');
    if (!row) throw new Error('Expected the recent chat row.');
    // Click the dropdown trigger (three-dot menu) instead of contextmenu
    const trigger = row.querySelector<HTMLElement>('.explorer-more');
    if (!trigger) throw new Error('Expected dropdown trigger');
    await act(async () => { trigger.click(); });
    // The menu must expose the chat management actions; the wording is a UI
    // choice that changes, so assert the outcomes — opening the menu exposes
    // an unread action, and choosing it marks this chat without opening it.
    expect(menuLabels().some((label) => /Mark unread/i.test(label))).toBe(true);
    expect(menuLabels().some((label) => /Archive/i.test(label))).toBe(true);
    expect(menuLabels().some((label) => /Delete/i.test(label))).toBe(true);
    await act(async () => { menuItems().find((item) => /Mark unread/i.test(item.textContent ?? ''))?.click(); });
    expect(actions).toEqual([{ id: 'ctx-chat', action: 'unread' }]);
    expect(opens).toEqual([]);
    const destination = host.querySelector<HTMLElement>('[role="treeitem"][title="Field notes"]');
    if (!destination) throw new Error('Expected the nested folder row.');
    const geometry = spyOn(destination, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 30));
    const transfer = new DataTransfer();
    await act(async () => { row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })); });
    await act(async () => {
      destination.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 }));
      destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 }));
      destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 80, clientY: 15 }));
    });
    geometry.mockRestore();
    expect(operations).toEqual([{ ids: [], chatIds: ['ctx-chat'], notes: [], parentId: 'folder', beforeId: null }]);
    expect(host.querySelectorAll('[role="treeitem"][title="Chat to file"]')).toHaveLength(1);
    expect(host.querySelector('[role="treeitem"][title="Field notes"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(opens).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await act(async () => root.unmount()); host.remove(); fetchMock.mockRestore(); }
});
