import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { MethodDefinition } from '@office/methods/domain';
import '../../support/web-dom.adapter';

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { TeamsWorkspace } = await import('../../../apps/web/src/market/teams-workspace.component');
const { ModelsWorkspace } = await import('../../../apps/web/src/models/models-workspace.component');
const { AssistantDirectory } = await import('../../../apps/web/src/chat/assistant-directory.component');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');
const { createServiceClient } = await import('../../../apps/web/src/shared/service-client.hook');
const { createConversationClient } = await import('../../../apps/web/src/chat/conversation-client.adapter');
const { GlassScene } = await import('@glass-sdk/liquid-glass');
const saved: MethodDefinition[] = [];
const requests: { path: string; body: unknown }[] = [];
const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
  if (path === '/bootstrap') return Response.json({ token: 'test' });
  if (path === '/api/v1/model-catalog/computer') return Response.json({ processor: 'Test CPU', memory: '16 GB' });
  if (path === '/api/v1/model-catalog') return Response.json({ source: 'bundled', release: '2026.42.1', models: [{ id: 'Qwen catalog model', recipe: 'llamacpp', labels: ['chat'], sizeGB: 1, downloaded: null, suggested: true }] });
  if (path === '/api/v1/model-connections' && init?.method !== 'PUT') return Response.json({ connections: [] });
  if (path === '/api/v1/model-connections' && init?.method === 'PUT') { const body = JSON.parse(String(init.body)); requests.push({ path, body }); return Response.json({ connection: body.connection, saved: true, credentialSaved: body.secret ? true : null }); }
  if (path.endsWith('/discover')) { requests.push({ path, body: null }); return Response.json({ discovered: 1, empty: false, connection: { id: path.split('/')[4], name: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: [], imageModels: [], observedModels: ['discovered-model'], observedAt: '2026-10-16T09:00:00Z', discovery: 'success', discoveryError: null } }); }
  if (path === '/api/v1/conversation-folders') return Response.json({ folders: [] });
  if (path === '/api/v1/automations' && init?.method !== 'POST') return Response.json({ automations: [] });
  if (path === '/api/v1/knowledge-feeds' && init?.method !== 'POST') return Response.json({ feeds: [{ id: 'lab-default', name: 'Gyro Lab frameworks', description: 'Default Lab references.', homepage: null, source: 'bundled', url: null, updatedAt: '2026-10-09T00:00:00.000Z', lastError: null, entries: [{ id: 'human-mark/THM.md', title: 'THM', description: 'Human Mark', filename: 'THM.md', collectionName: 'The Human Mark', publisher: 'Gyro', edition: 'v1', sourceUrl: 'https://example.com', rights: 'CC BY-SA 4.0', installed: true, documentId: 'lab-human-mark-THM.md' }, { id: 'eu-ai-act/AI_ACT.md', title: 'EU AI Act', description: 'Regulation text', filename: 'AI_ACT.md', collectionName: 'EU AI Act', publisher: 'EU', edition: '2024', sourceUrl: 'https://example.com/act', rights: 'CC BY 4.0', installed: false, documentId: 'lab-eu-ai-act-AI_ACT.md' }] }] });
  if (init?.method === 'POST') { requests.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({}); }
  throw new Error(`Unexpected request ${path}`);
}, { preconnect: globalThis.fetch.preconnect }));
const agent: MethodDefinition = { kind: 'preset', value: { id: 'agent-1', name: 'Research partner', instructions: 'Cite sources and distinguish assumptions.', model: 'model-a', provider: 'provider-a', settings: { temperature: .3 }, toolIds: ['tool-a'], skillIds: ['skill-a'], knowledgeCollectionIds: ['collection-a'], updatedAt: '2026-10-16T09:00:00Z' } };
let host: HTMLElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
async function mount(node: Parameters<ReturnType<typeof createRoot>['render']>[0]) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root!.render(createElement(AppDialogsProvider, null, node)); }); return host; }
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; requests.length = 0; saved.length = 0; });
afterAll(() => { fetchMock.mockRestore(); });

test('Assistance opens Teams and Market from matching widgets and retains chat controls', async () => {
  const opened: string[] = [];
  const client = createConversationClient(createServiceClient());
  const container = await mount(createElement(GlassScene, { appearance: 'light', material: 'regular', maxSurfaces: 8 }, createElement(AssistantDirectory, { client, chats: [], agents: [agent], activeId: null, appearance: 'light', sending: false, onTeams: () => opened.push('teams'), onMarket: () => opened.push('market'), onOpen: () => undefined, onNew: () => undefined, onChanged: async () => undefined })));
  expect(container.querySelectorAll('.assistance-widgets .launcher-widget')).toHaveLength(2);
  expect(container.querySelector('.directory-agents')).toBeNull();
  expect(container.querySelector('[aria-label="Search chats"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Create media"]')).toBeNull();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Open Teams"]')?.click(); container.querySelector<HTMLButtonElement>('[aria-label="Open Market"]')?.click(); });
  expect(opened).toEqual(['teams', 'market']);
});

test('Teams starts a chat with the selected agent and edits instructions without dropping its configuration', async () => {
  const started: string[] = [];
  const second: MethodDefinition = { kind: 'preset', value: { ...agent.value, id: 'agent-2', name: 'Synthesis partner' } };
  const container = await mount(createElement(TeamsWorkspace, { agents: [agent, second], sending: false, onChat: (id) => started.push(id), onManage: () => undefined, onSave: async (definition) => { saved.push(definition); return definition; } }));
  await act(async () => { [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes('Synthesis partner'))!.click(); });
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Start chat')?.click(); });
  expect(started).toEqual(['agent-2']);
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Edit agent')?.click(); });
  const textarea = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Updated instructions.'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { document.querySelector('[role="dialog"] form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ kind: 'preset', value: { id: 'agent-2', instructions: 'Updated instructions.', provider: 'provider-a', model: 'model-a', settings: { temperature: .3 }, toolIds: ['tool-a'], skillIds: ['skill-a'], knowledgeCollectionIds: ['collection-a'] } });
});

test('Models setup saves a cloud connection then discovers models through the service', async () => {
  const container = await mount(createElement(ModelsWorkspace, { scope: 'cloud' }));
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Add connection')!.click(); });
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('.model-template-grid button')].find((button) => button.textContent === 'OpenAI')!.click(); });
  // The connection editor renders in a body-level modal portal.
  expect(document.querySelector<HTMLInputElement>('input[type="url"]')?.value).toBe('https://api.openai.com/v1');
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Save and Test')?.click(); });
  expect(requests[0]?.path).toBe('/api/v1/model-connections');
  expect(requests[0]?.body).toMatchObject({ connection: { name: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: [] } });
  expect(requests[1]?.path).toMatch(/model-connections\/openai-.*\/discover$/);
  expect(document.body.textContent).toContain('Model list updated.');
});
