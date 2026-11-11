import { afterAll, expect, spyOn, test } from 'bun:test';
import type { ComponentProps } from 'react';
import type { MethodsWorkspaceState } from '../../../apps/web/src/market/methods-workspace.hook';
import { settingsSections } from '../../../apps/web/src/settings/settings.policy';
import '../../support/web-dom.adapter';


const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const { SettingsWorkspace } = await import('../../../apps/web/src/settings/settings-workspace.component');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');

const methods: MethodsWorkspaceState = {
  definitions: [],
  history: [],
  status: '',
  error: '',
  async refresh() {},
  async save(definition) { return definition; },
  async loadHistory() {},
  async restore() {},
  async exportBundle() { return null; },
  async importBundle() { return false; },
};

type Props = ComponentProps<typeof SettingsWorkspace>;

function serviceMock() {
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
}

function props(patch: Partial<Props> = {}): Props {
  return {
    rootName: 'Demo Workspace',
    authorized: true,
    authorizingUi: false,
    onAuthorize() {},
    theme: 'dark',
    onThemeChange() {},
    methods,
    attachedIds: [],
    onToggleAttach() {},
    collections: [],
    ...patch,
  };
}

function row(host: HTMLElement, label: string): HTMLElement {
  const control = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const found = control?.closest('.settings-pref-row');
  if (!found) throw new Error(`Missing settings row for ${label}`);
  return found as HTMLElement;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name);
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}

function selectedSection(host: HTMLElement): string | undefined {
  return host.querySelector('[role="listbox"][aria-label="Settings sections"] [aria-selected="true"]')?.getAttribute('data-key') ?? undefined;
}

async function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('The DOM input must support user input.');
  await act(async () => { setValue.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

async function mount(children: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  await act(async () => { root.render(<StrictMode><MemoryRouter><AppDialogsProvider>{children}</AppDialogsProvider></MemoryRouter></StrictMode>); });
  return {
    host,
    errors,
    async finish() { await act(async () => root.unmount()); host.remove(); },
  };
}

test('resource settings preserve other sources while managing skill and knowledge catalogs', async () => {
  const requests: { path: string; method: string; body: unknown }[] = [];
  let skillSources = [{ id: 'scientific-skills', kind: 'skill', name: 'Community skills', url: 'https://github.com/K-Dense-AI/scientific-agent-skills', format: 'github-skill-library-v1', enabled: true }, { id: 'native-automations', kind: 'automation', name: 'AIR Office templates', url: 'air-office:native-automations', format: 'air-office-native-v1', enabled: true }];
  let feeds = [{ id: 'lab', name: 'Lab', source: 'bundled', url: null, homepage: null, lastError: null, entries: [] }, { id: 'remote/feed', name: 'Research', source: 'remote', url: 'https://example.com/knowledge.json', homepage: null, lastError: null, entries: [] }];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const method = init?.method ?? 'GET';
    requests.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    if (path === '/api/v1/market/sources') {
      if (method === 'PUT') skillSources = JSON.parse(String(init?.body)).sources;
      return Response.json({ sources: skillSources });
    }
    if (path === '/api/v1/knowledge-feeds') {
      if (method === 'POST') feeds.push({ id: 'added', name: 'Added knowledge', source: 'remote', url: 'https://example.com/new-knowledge.json', homepage: null, lastError: null, entries: [] });
      return Response.json({ feeds });
    }
    if (path === '/api/v1/market/catalog' && method === 'GET') return Response.json({ sources: skillSources.map((source) => ({ ...source, state: 'ready' })), entries: [] });
    if (path === '/api/v1/knowledge-feeds/remote%2Ffeed' && method === 'DELETE') { feeds = feeds.filter((feed) => feed.id !== 'remote/feed'); return new Response(null, { status: 204 }); }
    if (path.endsWith('/refresh')) return Response.json({});
    throw new Error(`Unexpected test request ${method} ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  localStorage.clear();
  const view = await mount(<SettingsWorkspace {...props({ initialSection: 'skill' })} />);
  try {
    expect(selectedSection(view.host)).toBe('skill');
    expect(view.host.querySelector('[aria-label="Knowledge catalogs"]')).toBeNull();
    expect(view.host.querySelector('[aria-label="Skill sources"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Skill source URL"]')).toBeNull();
    expect(view.host.textContent).toContain('github-skill-library-v1');
    expect(view.host.querySelector('[aria-label="Source name native-automations"]')).toBeNull();
    await type(view.host.querySelector<HTMLInputElement>('[aria-label="Source name scientific-skills"]')!, 'Renamed skills');
    await act(async () => { view.host.querySelector<HTMLInputElement>('[aria-label="Enable source scientific-skills"]')!.click(); });
    await act(async () => { button(view.host, 'Save sources').closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(requests).toContainEqual({ path: '/api/v1/market/sources', method: 'PUT', body: { sources: [
      { id: 'scientific-skills', kind: 'skill', name: 'Renamed skills', url: 'https://github.com/K-Dense-AI/scientific-agent-skills', format: 'github-skill-library-v1', enabled: false },
      { id: 'native-automations', kind: 'automation', name: 'AIR Office templates', url: 'air-office:native-automations', format: 'air-office-native-v1', enabled: true },
    ] } });
    await act(async () => { button(view.host, 'Refresh source scientific-skills').click(); });
    expect(requests.some((request) => request.path === '/api/v1/market/catalog' && request.method === 'GET')).toBe(true);
    expect(view.host.textContent).toContain('Skill catalog checked.');
    await act(async () => { button(view.host, 'Remove source scientific-skills').click(); });
    expect(view.host.querySelector('[aria-label="Source name scientific-skills"]')).toBeNull();
    expect(skillSources).toHaveLength(1);
    expect(skillSources[0]!.kind).toBe('automation');
    await act(async () => { button(view.host, 'Add Scientific skills').click(); });
    expect(view.host.querySelector('[aria-label="Source name scientific-skills"]')).not.toBeNull();
    expect(skillSources).toHaveLength(2);
    expect(requests.filter((request) => request.path.startsWith('/api/v1/market/sources')).every((request) => ['GET', 'PUT'].includes(request.method))).toBe(true);
    await act(async () => { view.host.querySelector<HTMLElement>('[role="option"][data-key="knowledge"]')!.click(); });
    expect(view.host.querySelector('[aria-label="Knowledge catalogs"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Remove knowledge catalog Lab"]')).toBeNull();
    await type(view.host.querySelector<HTMLInputElement>('[aria-label="Knowledge catalog URL"]')!, 'https://example.com/new-knowledge.json');
    await act(async () => { button(view.host, 'Add catalog').closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(requests).toContainEqual({ path: '/api/v1/knowledge-feeds', method: 'POST', body: { url: 'https://example.com/new-knowledge.json' } });
    await act(async () => { button(view.host, 'Refresh knowledge catalog Research').click(); });
    expect(requests.some((request) => request.path === '/api/v1/knowledge-feeds/remote%2Ffeed/refresh' && request.method === 'POST')).toBe(true);
    await act(async () => { button(view.host, 'Remove knowledge catalog Research').click(); });
    expect(view.host.textContent).not.toContain('Research');
    expect(view.host.querySelector('[aria-label="Skill sources"]')).toBeNull();
    expect(view.errors).toEqual([]);
  } finally { await view.finish(); fetchMock.mockRestore(); }
});

test('Market source save failures retain name drafts and catalog failures remain visible', async () => {
  const source = { id: 'scientific-skills', kind: 'skill', name: 'Community skills', url: 'https://github.com/K-Dense-AI/scientific-agent-skills', format: 'github-skill-library-v1', enabled: true };
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    if (path === '/api/v1/knowledge-feeds') return Response.json({ feeds: [] });
    if (path === '/api/v1/market/sources' && init?.method === 'PUT') return Response.json({ error: 'Source settings could not be stored.' }, { status: 400 });
    if (path === '/api/v1/market/sources') return Response.json({ sources: [source] });
    if (path === '/api/v1/market/catalog') return Response.json({ entries: [], sources: [{ ...source, state: 'error', error: 'The community source is unavailable.' }] });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const view = await mount(<SettingsWorkspace {...props({ initialSection: 'market' })} />);
  try {
    const name = view.host.querySelector<HTMLInputElement>('[aria-label="Source name scientific-skills"]')!;
    await type(name, 'My skills');
    await act(async () => { button(view.host, 'Save sources').closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('Source settings could not be stored.');
    expect(name.value).toBe('My skills');
    expect(button(view.host, 'Save sources').disabled).toBe(false);
    await act(async () => { button(view.host, 'Refresh source scientific-skills').click(); });
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('The community source is unavailable.');
    expect(view.host.textContent).not.toContain('Skill catalog checked.');
    expect(view.errors).toEqual([]);
  } finally { await view.finish(); fetchMock.mockRestore(); }
});

test('the dashboard carries the product hero, the theme control and the jump links', async () => {
  const fetchMock = serviceMock();
  localStorage.clear();
  const toggles = { theme: '' };
  try {
    const view = await mount(<SettingsWorkspace {...props({ onThemeChange: (choice) => { toggles.theme = choice; } })} />);
    expect(selectedSection(view.host)).toBe('dashboard');
    expect(view.host.textContent).toContain('AIR Office');
    expect(view.host.textContent).toContain('Alpha Version 0.1.0');
    expect(view.host.querySelector('.settings-dashboard-hero-logo')).not.toBeNull();
    const theme = button(view.host, 'Theme');
    expect(theme.textContent).toContain('Dark');
    await act(async () => {
      theme.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      const light = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('Light'));
      if (!light) throw new Error('The Light option must render.');
      light.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
      light.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 }));
      light.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(toggles.theme).toBe('light');
    expect(view.host.querySelector('[aria-label="Assistant panel"]')).toBeNull();
    expect(view.host.textContent).toContain('Jump to');
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('section search navigates across settings groups and updates the stage location', async () => {
  const fetchMock = serviceMock();
  const locations: string[] = [];
  const view = await mount(<SettingsWorkspace {...props({ initialSection: 'data', onSectionChange: (section) => locations.push(section) })} />);
  try {
    await type(view.host.querySelector<HTMLInputElement>('[aria-label="Find a settings section"]')!, 'References');
    const option = view.host.querySelector<HTMLElement>('[role="option"][data-key="references"]')!;
    await act(async () => { option.click(); });
    expect(locations.at(-1)).toBe('references');
    expect(view.host.querySelector('[role="region"][aria-label="References settings"]')).not.toBeNull();
  } finally { await view.finish(); fetchMock.mockRestore(); }
});

test('instance defaults are edited from the advanced flags list and stay independent of personal values', async () => {
  const fetchMock = serviceMock();
  localStorage.clear();
  localStorage.setItem('air-office:instance-defaults', JSON.stringify({ 'knowledge.search-limit': 25 }));
  localStorage.setItem('air-office:settings-personal', JSON.stringify({ 'knowledge.search-limit': 5 }));
  try {
    const view = await mount(<SettingsWorkspace {...props({ initialSection: 'advanced' })} />);
    expect(selectedSection(view.host)).toBe('advanced');
    const limitRow = row(view.host, 'Results per search');
    expect(limitRow.textContent).toContain('Stored: 25');
    expect(limitRow.textContent).toContain('Effective: 5 (your setting)');
    const reset = [...limitRow.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Reset');
    if (!reset || reset.disabled) throw new Error('The stored instance value must be resettable.');
    await act(async () => { reset.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('air-office:instance-defaults') ?? '{}')).toEqual({});
    expect(JSON.parse(localStorage.getItem('air-office:settings-personal') ?? '{}')).toEqual({ 'knowledge.search-limit': 5 });
    expect(row(view.host, 'Results per search').textContent).toContain('Stored: Not set');
    expect(row(view.host, 'Temperature').querySelector('button[disabled]')).not.toBeNull();
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('the advanced flags search shows stored and effective values, validates input, and resets', async () => {
  const fetchMock = serviceMock();
  localStorage.clear();
  localStorage.setItem('air-office:settings-personal', JSON.stringify({ 'chat.temperature': 5 }));
  try {
    const view = await mount(<SettingsWorkspace {...props({ initialSection: 'advanced' })} />);
    const temperatureRow = row(view.host, 'Temperature');
    expect(temperatureRow.textContent).toContain('chat.temperature');
    expect(temperatureRow.textContent).toContain('Stored: 5 (invalid)');
    expect(temperatureRow.textContent).toContain('Effective: 0.7 (built-in default)');
    const input = view.host.querySelector<HTMLInputElement>('[aria-label="Temperature"]');
    if (!input) throw new Error('The temperature input must render.');
    await type(input, '1.25');
    expect(JSON.parse(localStorage.getItem('air-office:settings-personal') ?? '{}')).toEqual({ 'chat.temperature': 1.25 });
    expect(row(view.host, 'Temperature').textContent).toContain('Stored: 1.25');
    await type(input, '9');
    expect(row(view.host, 'Temperature').querySelector('[role="alert"]')?.textContent).toBe('Must be at most 2.');
    expect(JSON.parse(localStorage.getItem('air-office:settings-personal') ?? '{}')).toEqual({ 'chat.temperature': 1.25 });
    await type(view.host.querySelector<HTMLInputElement>('[aria-label="Search advanced settings"]')!, 'notice');
    expect(view.host.querySelectorAll('.settings-pref-row').length).toBe(1);
    expect(view.host.querySelector('[aria-label="Notice duration"]')).not.toBeNull();
    await type(view.host.querySelector<HTMLInputElement>('[aria-label="Search advanced settings"]')!, '');
    const reset = [...row(view.host, 'Temperature').querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Reset');
    if (!reset || reset.disabled) throw new Error('The stored personal value must be resettable.');
    await act(async () => { reset.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('air-office:settings-personal') ?? '{}')).toEqual({});
    expect(row(view.host, 'Temperature').textContent).toContain('Stored: Not set');
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('the data section reports the contract facts', async () => {
  const fetchMock = serviceMock();
  localStorage.clear();
  try {
    const data = await mount(<SettingsWorkspace {...props({ initialSection: 'data' })} />);
    expect(selectedSection(data.host)).toBe('data');
    expect(button(data.host, 'Download')).not.toBeNull();
    expect(data.host.textContent).not.toContain('Calendar import');
    expect(data.host.textContent).not.toContain('operator-provided');
    expect(data.host.querySelector('[aria-label="Local folders"]')).toBeNull();
    expect(data.errors).toEqual([]);
    await data.finish();
  } finally { fetchMock.mockRestore(); }
});

test('Apps sends folder organization to Programs with the existing owning scope', async () => {
  const opened: (string | undefined)[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [{ id: 'root', name: 'Documents', path: 'C:/Documents' }] });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes: [{ id: 'project', kind: 'project', name: 'Research', parentId: 'program' }, { id: 'mount', kind: 'mount', name: 'Documents', rootId: 'root', parentId: 'project' }] });
    throw new Error(`Unexpected request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  localStorage.clear();
  const view = await mount(<SettingsWorkspace {...props({ initialSection: 'today', onOpenPrograms: (id) => { opened.push(id); } })} />);
  try {
    await act(async () => { button(view.host, 'Open Programs').click(); });
    await act(async () => { button(view.host, 'Research').click(); });
    expect(opened).toEqual([undefined, 'project']);
  } finally { await view.finish(); fetchMock.mockRestore(); }
});

test('reset clears browser copies and drafts only after service success and refreshes the open workspace', async () => {
  let fail = true;
  let refreshed = 0;
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    if (path === '/api/v1/market/sources') return Response.json({ sources: [] });
    if (path === '/api/v1/external/roots') return Response.json({ roots: [] });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes: [] });
    if (path === '/api/v1/data/workspace' && init?.method === 'DELETE') return fail ? Response.json({ error: 'Finish active work first.' }, { status: 409 }) : Response.json({ conversationsDeleted: 1, documentsDeleted: 1, collectionsDeleted: 0, notesDeleted: 1 });
    throw new Error(`Unexpected request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const confirm = spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.clear();
  localStorage.setItem('air-office:browser-files', JSON.stringify([{ id: 'import', name: 'Old.txt', content: 'Old' }]));
  localStorage.setItem('air-office:theme', 'dark');
  const view = await mount(<SettingsWorkspace {...props({ initialSection: 'data', onWorkspaceCleared: async () => { refreshed++; } })} />);
  try {
    await act(async () => { button(view.host, 'Delete all content').click(); });
    expect(view.host.textContent).toContain('Finish active work first.');
    expect(localStorage.getItem('air-office:browser-files')).not.toBeNull();
    expect(refreshed).toBe(0);
    fail = false;
    await act(async () => { button(view.host, 'Delete all content').click(); });
    expect(localStorage.getItem('air-office:browser-files')).toBeNull();
    expect(localStorage.getItem('air-office:theme')).toBe('dark');
    expect(refreshed).toBe(1);
    expect(view.host.textContent).toContain('Cleared 1 conversations');
  } finally { await view.finish(); confirm.mockRestore(); fetchMock.mockRestore(); }
});

const demoApp = { id: 'policy-audit', name: 'Policy audit', description: 'Check a draft against the pack.', prompts: ['Step 1.'], runPrompts: ['Step 1.'], edited: false };

test('the apps section lists apps, edits one, and resets it to the Studio default', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const method = init?.method ?? 'GET';
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    if (path === '/api/v1/lab/apps' && method === 'GET') return Response.json({ apps: [demoApp] });
    if (path === '/api/v1/lab/apps/policy-audit' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as { name: string; description: string; prompts: string[] };
      return Response.json({ app: { ...demoApp, name: body.name, description: body.description, prompts: body.prompts, runPrompts: body.prompts, edited: true } });
    }
    if (path === '/api/v1/lab/apps/policy-audit' && method === 'DELETE') return Response.json({ app: demoApp });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  localStorage.clear();
  try {
    const view = await mount(<SettingsWorkspace {...props({ initialSection: 'apps' })} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view.host.textContent).toContain('Policy audit');
    expect(view.host.textContent).toContain('1 step');
    expect(view.host.querySelector('[aria-label="Step 1 instructions"]')).toBeNull();

    await act(async () => { button(view.host, 'Edit').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const nameInput = document.querySelector<HTMLInputElement>('[role="dialog"] input[required]');
    if (!nameInput) throw new Error('The app edit dialog must open with a name field.');
    await type(nameInput, 'Policy audit v2');
    expect(document.querySelector('[aria-label="Step 1 instructions"]')).not.toBeNull();
    const form = nameInput.closest('form');
    if (!form) throw new Error('The app edit dialog form must render.');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view.host.textContent).toContain('Policy audit v2');
    expect(view.host.textContent).toContain('Edited');
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => { button(view.host, 'Reset to Studio default').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view.host.textContent).toContain('Policy audit');
    expect(view.host.textContent).not.toContain('Policy audit v2');
    expect([...view.host.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === 'Reset to Studio default')).toBe(false);
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});
