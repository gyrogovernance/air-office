import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { createDocumentBuffer } from '@office/editor/domain';
import { draftKey } from '@office/editor/domain';
import { closeStageSurface, type StageState } from '@office/workspace/domain';
import { createRichDocument, documentMarkdown, emptyNativeBody, exportRichDocument, markdownToNativeBody, validateRichDocument } from '@office/editor/rich-document-domain';
import { restorePanelPreferences, withWelcomeSelected } from '../../../apps/web/src/app/workspace-shell.component';
import { closeVisitedWorkspace } from '../../../apps/web/src/app/workspace-navigation.policy';
import '../../support/web-dom.adapter';


const source = await Bun.file(new URL('../../../apps/web/src/app/workspace-shell.component.tsx', import.meta.url)).text();
const syntax = ts.createSourceFile('workspace-shell.component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function topLevelFunction(name: string, bindings: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  if (!declaration) throw new Error(`Missing workspace function ${name}`);
  const code = ts.transpileModule(declaration.getText(syntax), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings));
}
function componentCallback(name: string, bindings: Record<string, unknown>) {
  const start = source.indexOf(`const ${name} = useCallback(() => {`);
  if (start < 0) throw new Error(`Missing workspace callback ${name}`);
  const end = source.indexOf('\n  }, []);', start);
  if (end < 0) throw new Error(`Missing callback boundary ${name}`);
  const body = source.slice(start + `const ${name} = useCallback(() => {`.length, end);
  const code = ts.transpileModule(`function ${name}() {${body}\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings));
}
function preferenceHarness(viewportWidth: number, stored: Record<string, string> = {}) {
  const values = new Map(Object.entries(stored));
  const writes: Array<[string, string]> = [];
  const updates = { files: false, chat: false };
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); writes.push([key, value]); } };
  const matchMedia = (query: string) => ({ matches: query.includes('max-width') ? viewportWidth <= 711 : viewportWidth >= 920 });
  const setFilesOpen = (update: boolean | ((open: boolean) => boolean)) => { updates.files = typeof update === 'function' ? update(updates.files) : update; };
  const setChatOpen = (update: boolean | ((open: boolean) => boolean)) => { updates.chat = typeof update === 'function' ? update(updates.chat) : update; };
  const toggleFiles = componentCallback('toggleFiles', { setFilesOpen, setChatOpen, isCompactViewport: () => viewportWidth <= 711, window: { innerWidth: viewportWidth }, ALL_PANELS_MIN: 920, localStorage: storage });
  const toggleChat = componentCallback('toggleChat', { setChatOpen, setFilesOpen, isCompactViewport: () => viewportWidth <= 711, window: { innerWidth: viewportWidth }, ALL_PANELS_MIN: 920, localStorage: storage });
  return { values, writes, updates, toggleFiles, toggleChat, storage, matchMedia, viewportWidth };
}
function workspaceFunction(name: string, bindings: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  if (!declaration) throw new Error(`Missing workspace function ${name}`);
  const code = ts.transpileModule(declaration.getText(syntax), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings));
}
function fixture(content = '# Heading\n\n<!-- keep this -->\n') {
  const storage = new Map<string, string>();
  const errors: string[] = [];
  const buffer = createDocumentBuffer({ id: 'workspace:note', name: 'note.md', content, version: 'v1' });
  const bindings = {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
    draftKey, setError: (message: string) => errors.push(message)
  };
  return { storage, errors, buffer, bindings };
}

test('reset immediately removes open imported files, notes, buffers and stage tabs and invalidates pending loads', async () => {
  const calls: string[] = [];
  const scopeEpoch = { current: 1 };
  const contextEpoch = { current: 1 };
  const invoke = topLevelFunction('workspaceCleared', {
    scopeEpoch, contextEpoch, abortRef: { current: null }, loading: { current: new Map() },
    setResetRevision: () => calls.push('explorer-remount'),
    setFiles: (value: unknown[]) => { expect(value).toEqual([]); calls.push('imports'); },
    updateBuffers: (value: unknown) => { expect(value).toEqual({}); calls.push('buffers'); },
    saveRichBuffers: (value: unknown) => { expect(value).toEqual({}); calls.push('notes'); },
    setFileRichEdits: () => {}, previousFileRichDocuments: { current: new Map() },
    setConnectedRoots: () => {}, setAttachedMethodIds: () => {}, setFolderNavigation: () => {}, setSelection: () => {}, setProposal: () => {},
    updateStage: (value: StageState) => { expect(value.surfaces.map((surface) => surface.id)).toEqual(['settings']); calls.push('stage'); },
    chat: { open: async (id: unknown) => { expect(id).toBeNull(); }, refresh: async () => calls.push('chats') },
    methods: { refresh: async () => calls.push('methods') },
    explorerControls: { current: { refresh: async () => calls.push('tree') } },
  });
  await invoke();
  expect(scopeEpoch.current).toBe(2);
  expect(contextEpoch.current).toBe(2);
  expect(calls).toEqual(['explorer-remount', 'imports', 'buffers', 'notes', 'stage', 'chats', 'methods', 'tree']);
});

describe('workspace panel preferences', () => {
  test('Assistant switch toggles only Assistant and persists the choice on wide view', () => {
    const h = preferenceHarness(1280, { 'air-office:files-open': '1' });
    h.toggleChat();
    expect(h.updates).toEqual({ files: false, chat: true });
    expect(h.writes).toEqual([['air-office:chat-open', '1']]);
    expect(h.values.get('air-office:files-open')).toBe('1');
  });

  test('Files switch toggles only Files and persists the choice on wide view', () => {
    const h = preferenceHarness(1280, { 'air-office:chat-open': '1' });
    h.toggleFiles();
    expect(h.updates).toEqual({ files: true, chat: false });
    expect(h.writes).toEqual([['air-office:files-open', '1']]);
    expect(h.values.get('air-office:chat-open')).toBe('1');
  });

  test('each stored choice is restored on reload at a width that fits both panels', () => {
    expect(restorePanelPreferences(1280, false, { filesOpen: true, chatOpen: false })).toEqual({ files: true, chat: false });
  });

  test('a narrow viewport that cannot fit both panels closes the files panel while the assistant stays open', () => {
    expect(restorePanelPreferences(825, false, { filesOpen: true, chatOpen: true })).toEqual({ files: false, chat: true });
  });

  test('a compact viewport starts with no side panel', () => {
    expect(restorePanelPreferences(600, true, { filesOpen: true, chatOpen: true })).toEqual({ files: false, chat: false });
  });

  test('narrow-view toggles retain the current responsive policy and do not persist', () => {
    const h = preferenceHarness(825);
    h.toggleFiles();
    expect(h.updates).toEqual({ files: true, chat: false });
    expect(h.writes).toEqual([]);
    expect(h.values.size).toBe(0);
  });
});
describe('workspace content width budgets', () => {
  const dimensions = { LEFT_MIN: 208, LEFT_MAX: 420, RIGHT_MIN: 280, RIGHT_MAX: 420, STAGE_MIN: 400, SHELL_CHROME: 32, COMPACT_MAX: 711 };
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const railLimitsFor = workspaceFunction('railLimitsFor', dimensions);
  const fit = workspaceFunction('fitRailWidths', { ...dimensions, clamp, railLimitsFor });

  test('keeps comfortable rails and a useful document at desktop width', () => {
    expect(fit(1280, 256, 320, true, true)).toEqual({ left: 256, right: 320 });
  });
  test('reduces rail extras before taking the document below its minimum width', () => {
    expect(fit(920, 420, 420, true, true)).toEqual({ left: 208, right: 280 });
  });
  test('fits one usable assistant beside the document at tablet width', () => {
    expect(fit(825, 256, 320, false, true)).toEqual({ left: 0, right: 320 });
  });
  test('a wide requested inspector yields space to the document', () => {
    expect(fit(825, 256, 420, false, true)).toEqual({ left: 0, right: 393 });
  });
  test('a compact panel replaces the document and can be fully dismissed', () => {
    expect(fit(600, 256, 320, false, true)).toEqual({ left: 0, right: 568 });
    expect(fit(600, 256, 320, false, false)).toEqual({ left: 0, right: 0 });
  });
});

describe('responsive rail shares', () => {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const preferred = workspaceFunction('preferredRailWidth', { clamp });

  test('preferred width tracks the viewport share inside the rail clamps', () => {
    expect(preferred(0.2, 1280, 280, 420)).toBe(280);
    expect(preferred(0.2, 1600, 280, 420)).toBe(320);
    expect(preferred(0.2, 2100, 280, 420)).toBe(420);
    expect(preferred(0.2, 1000, 280, 420)).toBe(280);
  });

  test('legacy absolute pixels migrate to a viewport share once', () => {
    const values = new Map<string, string>([['air-office:left-width', '320']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const read = workspaceFunction('readRailShare', {
      RAIL_SHARE_DEFAULT: 0.2,
      RAIL_SHARE_FLOOR: 0.12,
      RAIL_SHARE_CEIL: 0.4,
      clamp,
      localStorage: storage,
    });
    expect(read('air-office:left-width', 1600)).toBe(0.2);
    expect(values.get('air-office:left-width')).toBe('0.2');
    expect(read('air-office:left-width', 2000)).toBe(0.2);
  });

  test('growing the window grows both rails from the same share before the stage takes the rest', () => {
    const dimensions = { LEFT_MIN: 280, LEFT_MAX: 420, RIGHT_MIN: 280, RIGHT_MAX: 420, STAGE_MIN: 400, SHELL_CHROME: 32, COMPACT_MAX: 711 };
    const railLimitsFor = workspaceFunction('railLimitsFor', dimensions);
    const fit = workspaceFunction('fitRailWidths', { ...dimensions, clamp, railLimitsFor });
    const narrow = fit(1280, preferred(0.25, 1280, 280, 420), preferred(0.25, 1280, 280, 420), true, true);
    const wide = fit(1800, preferred(0.25, 1800, 280, 420), preferred(0.25, 1800, 280, 420), true, true);
    expect(narrow).toEqual({ left: 320, right: 320 });
    expect(wide).toEqual({ left: 420, right: 420 });
    expect(wide.left).toBeGreaterThan(narrow.left);
  });
});

describe('closing Settings', () => {
  const surfaces: StageState['surfaces'] = [
    { id: 'first', fileId: 'first', title: 'First note', kind: 'rich-document' },
    { id: 'settings', title: 'Settings', kind: 'settings' },
    { id: 'second', fileId: 'second', title: 'Second note', kind: 'rich-document' },
  ];
  function closeSettings(state: StageState, returnId: string | null) {
    let result = state;
    const settingsReturnId = { current: returnId };
    // The navigation the component carries while on Settings: the documents
    // that were open are the back-stack, Settings is the current surface. The
    // real closeVisitedWorkspace/traverseWorkspace come from the navigation
    // policy module, since they are imported there rather than re-declared in
    // the component.
    const navigationRef = { current: { back: state.surfaces.filter((surface) => surface.id !== 'settings').map((surface) => surface.id), current: 'settings', forward: [] as (string | null)[] } };
    const close = workspaceFunction('closeSettingsWorkspace', { stageRef: { current: state }, navigationRef, settingsReturnId, closeStageSurface, closeVisitedWorkspace, isWorkspaceSurfaceId: () => false, navigate: () => {}, updateStage: (next: StageState) => { result = next; } });
    close();
    return { result, returnId: settingsReturnId.current };
  }
  test('returns to the document that opened Settings, preserving the open documents', () => {
    expect(closeSettings({ version: 1, surfaces, activeId: 'settings' }, 'first')).toEqual({
      result: { version: 1, surfaces: [surfaces[0], surfaces[2]], activeId: 'first' }, returnId: null,
    });
  });
  test('uses an available document when the original document has closed', () => {
    expect(closeSettings({ version: 1, surfaces, activeId: 'settings' }, 'missing').result.activeId).toBe('second');
  });
  test('returns to the empty workspace when Settings is the only surface', () => {
    expect(closeSettings({ version: 1, surfaces: [{ id: 'settings', title: 'Settings', kind: 'settings' }], activeId: 'settings' }, null).result).toEqual({ version: 1, surfaces: [], activeId: null });
  });
});

describe('workspace Markdown integration safety', () => {
  test('switching views only changes the view and preserves exact source and draft state', () => {
    const f = fixture('---\r\ntitle: Example\r\n---\r\n\r\n<!-- keep -->\r\nText  \r\n');
    let modes: Record<string, boolean> = {};
    const contextEpoch = { current: 0 };
    const toggle = workspaceFunction('toggleFileSourceMode', {
      buffersRef: { current: { [f.buffer.file.id]: f.buffer } }, contextEpoch,
      setSelection: () => undefined, setProposal: () => undefined,
      setFileSourceMode: (update: (previous: Record<string, boolean>) => Record<string, boolean>) => { modes = update(modes); }
    });
    const original = JSON.stringify(f.buffer);
    for (let i = 0; i < 10; i++) toggle(f.buffer.file.id);
    expect(JSON.stringify(f.buffer)).toBe(original);
    expect(f.storage.size).toBe(0);
    expect(modes[f.buffer.file.id]).toBe(false);
  });
  test('retains the first original source while updating the recoverable source', () => {
    const f = fixture();
    const preserve = workspaceFunction('preserveMarkdownSource', f.bindings);
    expect(preserve(f.buffer)).toBe(true);
    expect(preserve({ ...f.buffer, content: 'new source' })).toBe(true);
    expect(f.storage.get(`${draftKey(f.buffer.file.id)}:original-source`)).toBe(f.buffer.content);
    expect(f.storage.get(`${draftKey(f.buffer.file.id)}:source`)).toBe('new source');
  });

  test('refuses conversion when browser source protection fails', () => {
    const f = fixture();
    const preserve = workspaceFunction('preserveMarkdownSource', { ...f.bindings, localStorage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
    expect(preserve(f.buffer)).toBe(false);
    expect(f.errors).toHaveLength(1);
  });

  test('exports authoritative Markdown exactly without conversion', async () => {
    const f = fixture();
    let downloaded: Blob | undefined;
    const notices: string[] = [];
    const exportNote = workspaceFunction('exportNote', {
      buffersRef: { current: { [f.buffer.file.id]: f.buffer } }, richBuffersRef: { current: {} }, fileRichEdits: {},
      isMarkdownFile: () => true, createRichDocument, markdownToNativeBody, exportRichDocument, Blob,
      window: { confirm: () => { throw new Error('Exact Markdown must not need conversion approval'); } },
      document: { createElement: () => ({ href: '', download: '', click() {} }) },
      URL: { createObjectURL: (blob: Blob) => { downloaded = blob; return 'blob:test'; }, revokeObjectURL() {} },
      setNotice: (notice: string) => notices.push(notice)
    });
    exportNote(f.buffer.file.id, 'markdown');
    expect(await downloaded?.text()).toBe(f.buffer.content);
    expect(notices[0]).toBe('Markdown exported.');
  });

  test('adds attachments without replacing Markdown source', async () => {
    const f = fixture();
    const document = createRichDocument('note', f.buffer.file.id);
    const previous = { current: new Map([[f.buffer.file.id, document]]) };
    let retained: Record<string, unknown> = {};
    const attach = workspaceFunction('attachToRichDocument', {
      buffersRef: { current: { [f.buffer.file.id]: f.buffer } }, previousFileRichDocuments: previous,
      fileRichEdits: {}, setFileRichEdits: (edits: Record<string, unknown>) => { retained = edits; },
      setError: f.bindings.setError, crypto, validateRichDocument, localStorage: f.bindings.localStorage,
      preserveMarkdownSource: workspaceFunction('preserveMarkdownSource', f.bindings),
      FileReader: class { result = 'data:text/plain;base64,aGk='; onload?: () => void; readAsDataURL() { this.onload?.(); } }
    });
    await attach(f.buffer.file.id, { size: 2, type: 'text/plain', name: 'attachment.txt' });
    expect(JSON.stringify(previous.current.get(f.buffer.file.id)?.attachments ?? retained)).toContain('attachment.txt');
    expect(f.errors).toHaveLength(0);
  });

  test('retains rich-only edits without changing source or switching views', () => {
    const f = fixture('Original text\n');
    const writes: string[] = [];
    let retained: Record<string, unknown> = {};
    const body = markdownToNativeBody('Original text\n');
    const update = workspaceFunction('updateFileRichContent', {
      buffersRef: { current: { [f.buffer.file.id]: f.buffer } }, stageRef: { current: { activeId: f.buffer.file.id } }, ready: true,
      previousFileRichDocuments: { current: new Map() }, fileRichEdits: {},
      createRichDocument, emptyNativeBody, documentMarkdown, validateRichDocument,
      preserveMarkdownSource: workspaceFunction('preserveMarkdownSource', f.bindings),
      localStorage: f.bindings.localStorage,
      setFileRichEdits: (edits: Record<string, unknown>) => { retained = edits; },
      setContent: (text: string) => writes.push(text), setError: f.bindings.setError
    });
    update(f.buffer.file.id, body);
    expect(f.errors).toHaveLength(0);
    expect(retained[f.buffer.file.id]).toBeDefined();
  });

  test('keeps the rich-edit source keyed to the live markdown export', () => {
    const f = fixture('Original text\n');
    const writes: string[] = [];
    let retained: Record<string, { source: string; document: unknown }> = {};
    const body = markdownToNativeBody('- **Deductive:** Three-dimensional structure follows.\n');
    const liveMarkdown = '- **Deductive:** Three-dimensional structure follows.\n';
    const update = workspaceFunction('updateFileRichContent', {
      buffersRef: { current: { [f.buffer.file.id]: f.buffer } }, stageRef: { current: { activeId: f.buffer.file.id } }, ready: true,
      previousFileRichDocuments: { current: new Map() }, fileRichEdits: {},
      createRichDocument, emptyNativeBody, documentMarkdown, validateRichDocument,
      preserveMarkdownSource: workspaceFunction('preserveMarkdownSource', f.bindings),
      localStorage: f.bindings.localStorage,
      setFileRichEdits: (edits: Record<string, { source: string; document: unknown }>) => { retained = edits; },
      setContent: (text: string) => writes.push(text), setError: f.bindings.setError
    });
    update(f.buffer.file.id, body, liveMarkdown);
    const entry = retained[f.buffer.file.id];
    expect(entry?.source).toBe(liveMarkdown);
    expect(writes.at(-1) ?? f.buffer.content).toBe(liveMarkdown);
  });
});

describe('rich note save recovery', () => {
  test('preserves the draft and identifies an external canonical conflict', async () => {
    const document = createRichDocument('Conflict', 'conflict-note');
    const errors: string[] = [];
    const protectedDrafts: unknown[] = [];
    const buffers = { [document.id]: document };
    const save = workspaceFunction('saveRichNote', {
      richBuffers: buffers,
      richBuffersRef: { current: buffers },
      richBufferFor: (id: string) => buffers[id] ?? Object.values(buffers).find((note) => note.path === id || note.id === id),
      serviceClient: { json: async () => { throw new Error('HTTP 409: This note changed externally. Reopen it before trying again.'); } },
      noteProjection: { refresh: async () => ({ kind: 'ok' as const }) },
      draftKey: (id: string) => `draft:${id}`,
      setProjectionConflictOpen: () => {},
      validateRichDocument,
      protectRichDraft: (draft: unknown) => protectedDrafts.push(draft),
      setError: (message: string) => errors.push(message),
      setNotice: () => {}, saveRichBuffers: () => {}, localStorage: { getItem: () => null, removeItem: () => {} }
    });
    await save(document.id);
    expect(protectedDrafts).toEqual([document]);
    expect(errors[0]).toContain('changed outside AIR Office');
  });
});

describe('welcome stage selection', () => {
  test('Welcome clears the active surface while keeping open tabs', () => {
    const calendar = { id: 'calendar', kind: 'calendar' as const, title: 'Calendar' };
    const programs = { id: 'programs', kind: 'programs' as const, title: 'Programs' };
    expect(withWelcomeSelected({ version: 1, surfaces: [calendar, programs], activeId: 'calendar' })).toEqual({
      version: 1, surfaces: [calendar, programs], activeId: null,
    });
  });

  test('showChat does not flip Welcome off (stage selection stays authoritative)', () => {
    const start = source.indexOf('function showChat(');
    const end = source.indexOf('function openChatStage(', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(source.slice(start, end)).not.toContain('setWelcomeSelected(false)');
  });

  test('logo Welcome uses selectWelcome rather than a soft overlay flag', () => {
    expect(source).toContain('onWelcome={selectWelcome}');
    expect(source).toContain('function selectWelcome()');
    expect(source).toContain('withWelcomeSelected(stageRef.current)');
  });
});
