import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import type { ServiceClient } from '../../../apps/web/src/shared/service-client.hook';
import type { WorkspaceNodeInput } from '@office/workspace/domain';
import '../../support/web-dom.adapter';


const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AppsSettingsSection } = await import('../../../apps/web/src/market/apps-settings.component');
const { GlossaryWorkspace } = await import('../../../apps/web/src/market/glossary-workspace.component');
const { AppDialogsProvider } = await import('../../../apps/web/src/shared/app-dialogs.component');
const { AppsWorkspace } = await import('../../../apps/web/src/market/apps-workspace.component');
const { FellowshipWorkspace, CraftWorkspace } = await import('../../../apps/web/src/app/fellowship-workspace.component');
const { filePreparedNote, prepareResearchProject } = await import('../../../apps/web/src/app/fellowship-workspace.adapter');
const { createVaultWorkspaceStore } = await import('@office/workspace/service');
const { createVaultRichDocumentStore } = await import('@office/editor/rich-document-service');
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { craftSubmissionMarkdown, fellowshipResearchMarkdown } = await import('../../../apps/web/src/app/fellowship-workspace.policy');
const { createRichDocument } = await import('@office/editor/rich-document-domain');
const { createServiceClient } = await import('../../../apps/web/src/shared/service-client.hook');
afterEach(() => { sessionStorage.clear(); });

const app = {
  id: 'meta-evaluation',
  name: 'Meta-evaluation',
  description: 'Three-pass Human Mark review.',
  prompts: ['Pass 1.', 'Pass 2.', 'Pass 3.'],
  runPrompts: ['Pass 1.', 'Pass 2.', 'Pass 3.'],
  system: 'system text',
  edited: false,
};

function serviceMock(created: unknown[] = [], catalog = [app], workspaceNodes: unknown[] = []) {
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token', serviceBase: 'http://127.0.0.1:4317' });
    if (path === '/api/v1/crafts') return Response.json({ crafts: ['Review standard', 'Research standard'].map((name, index) => ({ package: { id: `standard-${index}`, name, description: `${name} summary for the preview.`, version: '1.0.0', runtime: 'composition', requirements: [], methods: [], automations: [] }, bindings: {}, enabled: true })), resources: [], methods: [], automations: [] });
    if (path === '/api/v1/knowledge-feeds') return Response.json({ feeds: [] });
    if (path === '/gyrogovernance/air-craft/main/AIR-Craft.md') return new Response('### General\n- emoji: 📘\n- title: Test product\n- description: A sample catalogue product.\n- linkText: Open product\n- linkUrl: https://example.test/product', { status: 200 });
    if (path === '/api/v1/lab/glossary') return Response.json({ entries: [{ id: 'a', title: 'Authority', content: 'First definition', collection: 'Terms', source: 'Source A', license: null }, { id: 'b', title: 'Agency', content: 'Second definition', collection: 'Terms', source: 'Source B', license: null }, { id: 'grammar', title: 'Grammar', content: '# Grammar\n\n## Parser\n\n```python\n# Usage\nprint("example")\n```\n\n## Examples\n\nReference text.', collection: 'Human Mark grammar', source: 'The Human Mark', license: 'CC BY-SA 4.0' }] });
    if (path === '/api/v1/automations') return Response.json({ automations: [] });
    if (path === '/api/v1/workspace/nodes') return Response.json({ nodes: workspaceNodes });
    if (path === '/api/v1/lab/apps' && init?.method === 'POST') { const body = JSON.parse(String(init.body)); created.push(body); return Response.json({ app: { ...app, ...body, id: 'custom-test', custom: true } }); }
    if (path === '/api/v1/lab/apps') return Response.json({ apps: catalog });
    throw new Error(`Unexpected test request ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
}

async function mount(children: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error), onCaughtError: (error) => errors.push(error) });
  await act(async () => { root.render(<StrictMode><AppDialogsProvider>{children}</AppDialogsProvider></StrictMode>); });
  return {
    host,
    errors,
    async finish() { await act(async () => root.unmount()); host.remove(); },
  };
}

test('the stage shows step counts and an empty results state without printing prompts', async () => {
  const fetchMock = serviceMock();
  try {
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider="openai" model="gpt-4o" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(view.host.textContent).toContain('Meta-evaluation');
    expect(view.host.textContent).toContain('3 steps');
    // The results region is empty until the app runs, and it never shows the
    // step prompts themselves.
    expect(view.host.querySelector('[aria-label="Results"]')?.querySelector('article')).toBeNull();
    expect(view.host.textContent).not.toContain('Pass 1.');
    expect(view.host.textContent).not.toContain('system text');
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('the demo model can run after entering source material', async () => {
  const fetchMock = serviceMock();
  try {
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider="local-replay" model="local-replay" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const run = [...view.host.querySelectorAll('button')].find((candidate) => candidate.textContent?.startsWith('Run action'));
    if (!run) throw new Error('The run button must render.');
    expect(run.disabled).toBe(true);
    const source = view.host.querySelector<HTMLTextAreaElement>('[aria-label="Source material"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(source, 'Try this app'); source.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(run.disabled).toBe(false);
    // The app runs in demo mode, which the run states without naming a
    // specific model.
    expect(view.host.textContent).toContain('Demo mode echoes your input');
    expect(view.host.textContent).not.toContain('Demo model (no AI)');
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('an unassigned model blocks the run with a model hint', async () => {
  const fetchMock = serviceMock();
  try {
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider="" model="unassigned" />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const run = [...view.host.querySelectorAll('button')].find((candidate) => candidate.textContent?.startsWith('Run action'));
    if (!run) throw new Error('The run button must render.');
    expect(run.disabled).toBe(true);
    // With no model assigned the run stays blocked and the reason is reported.
    expect(view.host.querySelector('.lab-apps-notice')).not.toBeNull();
    expect(view.errors).toEqual([]);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('glossary search changes the reader and clears it when nothing matches', async () => {
  const fetchMock = serviceMock();
  try {
    const view = await mount(<GlossaryWorkspace client={createServiceClient()}/>);
    await act(async () => { [...view.host.querySelectorAll<HTMLButtonElement>('.glossary-views [role="tab"]')].find((tab) => tab.textContent === 'Definitions')?.click(); });
    expect(view.host.querySelector('.glossary-term-title')?.textContent).toBe('Agency');
    expect(view.host.querySelectorAll('details, summary')).toHaveLength(0);
    expect(view.host.querySelector('.glossary-definitions')?.textContent).toContain('First definition');
    expect(view.host.querySelector('.glossary-definitions')?.textContent).not.toContain('print("example")');
    expect(view.host.querySelector('[aria-label="Glossary collection"]')).toBeNull();
    const input = view.host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const type = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); };
    await type('Agency');
    expect(view.host.querySelector('.glossary-term-title')?.textContent).toBe('Agency');
    expect(view.host.querySelector('article')?.textContent).toContain('Second definition');
    await type('unmatched');
    expect(view.host.querySelector('article')).toBeNull();
    expect(view.host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => { [...view.host.querySelectorAll<HTMLButtonElement>('.glossary-views [role="tab"]')].find((tab) => tab.textContent === 'Grammar guide')?.click(); });
    expect(view.host.querySelector('.glossary-reference pre')?.textContent).toContain('# Usage');
    expect([...view.host.querySelectorAll('.glossary-reference h2')].map((heading) => heading.textContent)).toEqual(['Parser', 'Examples']);
    expect(view.host.querySelectorAll('.glossary-reference h1')).toHaveLength(1);
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('Apps keeps source material when returning from model settings', async () => {
  const fetchMock = serviceMock();
  try {
    sessionStorage.setItem('air-office:app-source-draft', JSON.stringify({ text: 'Draft evidence', instructions: 'Focus on citations' }));
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider="openai" model="gpt-4o"/>);
    expect(view.host.querySelector<HTMLTextAreaElement>('[aria-label="Source material"]')?.value).toBe('Draft evidence');
    expect(view.host.querySelector<HTMLTextAreaElement>('[aria-label="Optional scope"]')?.value).toBe('Focus on citations');
    await view.finish();
  } finally { sessionStorage.removeItem('air-office:app-source-draft'); fetchMock.mockRestore(); }
});


test('Settings creates an app with the chosen emoji and exact step text', async () => {
  const created: unknown[] = [];
  const fetchMock = serviceMock(created);
  try {
    const view = await mount(<AppsSettingsSection/>);
    await act(async () => { [...view.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Add action')?.click(); });
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('[aria-label="Choose an app emoji"]')).toBeNull();
    expect(dialog.querySelector<HTMLInputElement>('[aria-label="Action emoji"]')?.value).toBe('');
    const name = dialog.querySelector<HTMLInputElement>('input[required]')!;
    const instructions = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(name, 'Evidence check'); name.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(instructions, 'Keep this exact instruction.'); instructions.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { const icon = dialog.querySelector<HTMLInputElement>('[aria-label="Action emoji"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(icon, '🧪'); icon.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { dialog.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(created).toEqual([{ name: 'Evidence check', description: '', prompts: ['Keep this exact instruction.'], icon: '🧪' }]);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(view.host.querySelector('[role="status"]')).not.toBeNull();
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test('References exposes Arcade and Fluent Emoji attribution with bundled license links', async () => {
  const { ReferencesWorkspace } = await import('../../../apps/web/src/market/references-workspace.component');
  const view = await mount(<ReferencesWorkspace/>);
  try {
    // Each bundled dependency links to the license it ships under.
    expect(view.host.querySelector('a[href="/arcade/LICENSE"]')).not.toBeNull();
    expect(view.host.querySelector('a[href="/arcade/games/TWEMOJI-LICENSE.txt"]')).not.toBeNull();
    expect(view.host.querySelector('a[href="/licenses/fluent-emoji-MIT.txt"]')).not.toBeNull();
  } finally { await view.finish(); }
});

test('Fellowship creates the selected contribution plan and routes work through native Office tools', async () => {
  const created: unknown[] = [];
  const opened: string[] = [];
  const fetchMock = serviceMock([], [app], [
    { id: 'research-program', kind: 'program', name: 'AIR Fellowship', parentId: null },
    { id: 'research', kind: 'project', name: 'Research project', parentId: 'research-program' },
  ]);
  const fellowship = await mount(<FellowshipWorkspace onCreateWorkspace={async (plan) => { created.push(plan); return 'research'; }} onCreateSubmissionDraft={async () => {}} onOpenDestination={(destination) => opened.push(destination)} onOpenReviewApp={(appId, scopeId) => { opened.push(`${appId}:${scopeId}`); }}/>);
  try {
    const button = (label: string) => [...fellowship.host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.includes(label));
    await act(async () => { button('New project')?.click(); });
    await act(async () => { button('Ecology')?.click(); button('Evaluation')?.click(); });
    const question = fellowship.host.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(question, '  Can this safety claim be reproduced?  '); question.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { button('Start project')?.click(); });
    await act(async () => { button('Your work')?.click(); });
    await act(async () => { button('Teams')?.click(); });
    await act(async () => { button('Map evidence')?.click(); });
    await act(async () => { button('Open Programs')?.click(); });
    expect(created).toEqual([{ route: 'ecology', contribution: 'evaluation', question: 'Can this safety claim be reproduced?' }]);
    expect(opened).toEqual(['teams', 'policy-audit:research', 'programs']);
    await act(async () => { button('Explore Crafts')?.click(); });
    expect([...fellowship.host.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.href)).toEqual(expect.arrayContaining([
      'https://github.com/gyrogovernance/air-craft/blob/main/FELLOW_AGREEMENT.md',
      'https://github.com/gyrogovernance/air-craft/discussions/new?category=introductions',
    ]));
  } finally { await fellowship.finish(); fetchMock.mockRestore(); }
});

test('Craft opens Standards first, summarizes standards, and keeps Products in Fellowship flow', async () => {
  const fetchMock = serviceMock();
  const opened: string[] = [];
  const craft = await mount(<CraftWorkspace onOpenFellowship={() => opened.push('fellowship')}/>);
  try {
    const standardsTab = craft.host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    expect(standardsTab?.getAttribute('data-key')).toBe('crafts');
    expect(standardsTab?.textContent).toContain('Standards');
    expect(craft.host.querySelectorAll('.collection-preview-bubble')).toHaveLength(1);
    expect(craft.host.querySelector('.collection-preview-bubble')?.textContent).toBe('Verified by Gyro Governance Lab.');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(craft.host.querySelector('.collection-dashboard__preview')?.textContent).toContain('Review standard summary for the preview.');
    const standards = [...craft.host.querySelectorAll<HTMLElement>('[role="option"]')].filter((option) => /Review standard|Research standard/.test(option.textContent ?? ''));
    expect(standards).toHaveLength(2);
    expect(standards.every((option) => option.textContent?.includes('Enabled'))).toBe(true);

    const productsTab = craft.host.querySelector<HTMLButtonElement>('[role="tab"][data-key="projects"]');
    expect(productsTab).not.toBeNull();
    await act(async () => { productsTab!.click(); });
    expect(craft.host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Products');
    const button = (label: string) => [...craft.host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.includes(label));
    await act(async () => { button('Open Fellowship')?.click(); });
    expect(opened).toEqual(['fellowship']);
    expect(craft.host.querySelector('[aria-labelledby="craft-submit-title"]')).not.toBeNull();
    expect([...craft.host.querySelectorAll<HTMLAnchorElement>('a')].map((link) => link.href)).toEqual(expect.arrayContaining([
      'https://github.com/gyrogovernance/air-craft/blob/main/protocols/submissions/README.md',
    ]));
    expect(craft.host.querySelector('[aria-label="AIR-Craft publication flow"]')).toBeNull();
  } finally { await craft.finish(); fetchMock.mockRestore(); }
});

test('Fellowship and Craft templates preserve route, provenance, review, and publication requirements', () => {
  const research = fellowshipResearchMarkdown({ route: 'employment', contribution: 'dataset', question: '  What evidence is missing?  ' });
  expect(research).toContain('**AIR-Craft route:** Employment');
  expect(research).toContain('**Contribution:** Dataset');
  expect(research).toContain('## Claims and evidence');
  expect(research).toContain('AI-assisted searches, summaries, analysis, or drafting');
  const submission = craftSubmissionMarkdown();
  expect(submission).toContain('**Fellowship introduction URL:**');
  expect(submission).toContain('GTD, IVD, IAD, and IID');
  expect(submission).toContain('**Submission issue URL:**');
});

test('research projects use Program ownership and preserve an existing project while filing notes', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'office-apps-workspace-'));
  process.env.AIR_VAULT_ROOT = vaultRoot;
  const store = createVaultWorkspaceStore({ vaultRoot });
  const notes = createVaultRichDocumentStore(vaultRoot);
  const client: ServiceClient = {
    base: 'http://service.test',
    token: async () => 'test',
    request: async () => new Response(),
    json: async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (path === '/api/v1/workspace/nodes' && !init?.method) return { nodes: store.list() } as T;
      const input = JSON.parse(String(init?.body)) as WorkspaceNodeInput;
      return { node: store.create(input) } as T;
    },
  };
  try {
    const plan = { route: 'ecology', contribution: 'report', question: 'What evidence is missing?' } as const;
    const first = await prepareResearchProject(client, plan);
    expect((await prepareResearchProject(client, plan)).id).toBe(first.id);
    expect(store.list().filter((node) => node.kind === 'program').map((node) => node.name).filter((name) => name !== 'General')).toEqual(['AIR Fellowship']);
    expect(store.get(first.parentId ?? '')?.name).toBe('AIR Fellowship');
    const other = store.create({ id: 'other', kind: 'program', name: 'Existing work' });
    const selected = await prepareResearchProject(client, { ...plan, parentId: other.id });
    expect(selected.parentId).toBe(other.id);
    store.update(selected.id, { instruction: 'Keep my existing instructions' });
    await prepareResearchProject(client, { ...plan, parentId: selected.id });
    expect(store.get(selected.id)?.instruction).toBe('Keep my existing instructions');
    const document = notes.save(createRichDocument('Research record'));
    await filePreparedNote(client, document, selected.id);
    expect(store.list().filter((node) => node.kind === 'note').map((node) => ({ parentId: node.parentId, name: node.name }))).toEqual([{ parentId: selected.id, name: 'Research record' }]);
  } finally {
    store.close();
    notes.close();
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});


test('each app keeps its own source and scope draft', async () => {
  const fetchMock = serviceMock([], [app, { ...app, id: 'policy-audit', name: 'Policy audit' }]);
  try {
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider="openai" model="model-a"/>);
    const field = () => view.host.querySelector<HTMLTextAreaElement>('[aria-label="Source material"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), 'Meta source'); field().dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...view.host.querySelectorAll<HTMLElement>('[role="option"]')].find((button) => button.textContent?.includes('Policy audit'))?.click(); });
    expect(field().value).toBe('');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field(), 'Audit source'); field().dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...view.host.querySelectorAll<HTMLElement>('[role="option"]')].find((button) => button.textContent?.includes('Meta-evaluation'))?.click(); });
    expect(field().value).toBe('Meta source');
    expect(JSON.parse(sessionStorage.getItem('air-office:app-source-drafts') ?? '{}')['policy-audit'].text).toBe('Audit source');
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});

test.each([false, true])('Apps streams every step with demo=%s', async (demo) => {
  const submitted: { messages: { role: string; content: string }[]; runId: string }[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/bootstrap') return Response.json({ token: 'test', serviceBase: 'http://127.0.0.1:4317' });
    if (url.pathname === '/api/v1/lab/apps') return Response.json({ apps: [app] });
    if (url.pathname === '/api/v1/runs') { const body = JSON.parse(String(init?.body)); submitted.push(body); return Response.json({ events: `/fixture/${body.runId}`, cancel: '/cancel' }); }
    if (url.pathname.startsWith('/fixture/')) {
      const runId = url.pathname.slice('/fixture/'.length);
      const envelope = (sequence: number, type: string, payload: unknown) => ({ protocolVersion: 1, eventId: `${runId}:${sequence}`, correlationId: runId, runId, sequence, timestamp: '2026-10-17T00:00:00Z', type, payload });
      return new Response([envelope(0, 'text-delta', { text: demo ? submitted.at(-1)?.messages.at(-1)?.content : `Result ${submitted.length}` }), envelope(1, 'completion', { reason: 'stop' })].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    }
    throw new Error('Unexpected fixture request');
  }, { preconnect: globalThis.fetch.preconnect }));
  try {
    const view = await mount(<AppsWorkspace client={createServiceClient()} provider={demo ? 'local-replay' : 'cloud'} model={demo ? 'local-replay' : 'test-model'}/>);
    const source = view.host.querySelector<HTMLTextAreaElement>('[aria-label="Source material"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(source, demo ? 'My demo source' : 'a'.repeat(120000)); source.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...view.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.startsWith('Run action'))?.click(); });
    expect(submitted).toHaveLength(3);
    if (demo) {
      expect(submitted.every((request) => JSON.stringify(request.messages) === JSON.stringify([{ role: 'user', content: 'My demo source' }]))).toBe(true);
      expect(view.host.querySelector('[role="status"]')).not.toBeNull();
      expect(view.host.textContent).toContain('My demo source');
      expect(view.host.textContent).not.toContain('Pass 1.');
      expect(view.host.textContent).not.toContain('system text');
    } else {
      expect(submitted[0]?.messages[1]?.content.length).toBeGreaterThan(120000);
      expect(submitted[1]?.messages).toContainEqual({ role: 'assistant', content: 'Result 1' });
      expect(submitted[2]?.messages.at(-1)).toEqual({ role: 'user', content: 'Pass 3.' });
      expect(view.host.querySelector('[role="status"]')).not.toBeNull();
      expect(view.host.textContent).toContain('Result 3');
    }
    await view.finish();
  } finally { fetchMock.mockRestore(); }
});


