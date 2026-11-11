import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalAiImportFolder } from '../../../../apps/web/src/models/local-ai/local-ai-import-folder.component';
import '../../../support/web-dom.adapter';


const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

test('browser-only view explains native availability and file preservation', () => {
  const html = renderToStaticMarkup(createElement(LocalAiImportFolder, { desktopAvailable: false, importFolder: async () => ({}) }));
  expect(html).toContain('disabled');
  expect(html).toContain('Available in the desktop app.');
  expect(html).toContain('Files stay in place');
  expect(html).not.toContain('type="file"');
});

test('native selection sends only its identity and refreshes after import', async () => {
  const sent: unknown[] = []; let refreshes = 0;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(LocalAiImportFolder, { desktopAvailable: true, selectFolder: async () => ({ id: 'opaque-id', label: 'My models' }), importFolder: async (value) => { sent.push(value); }, onImported: () => { refreshes++; } })));
    await act(async () => host.querySelector('button')!.click());
    expect(sent).toEqual([{ id: 'opaque-id' }]);
    expect(refreshes).toBe(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('My models');
    expect(host.textContent).toContain('Using My models');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('cancelled picker sends nothing and failures show a bounded message without paths', async () => {
  let requests = 0; let fail = false;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(LocalAiImportFolder, { desktopAvailable: true, selectFolder: async () => { if (fail) throw new Error('C:\\private\\sensitive'); return null; }, importFolder: async () => { requests++; } })));
    await act(async () => host.querySelector('button')!.click());
    expect(requests).toBe(0);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    fail = true;
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be imported');
    expect(host.textContent).not.toContain('sensitive');
    expect(host.querySelector('button')!.disabled).toBe(false);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
