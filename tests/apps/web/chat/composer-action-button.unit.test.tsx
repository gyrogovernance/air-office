import { afterAll, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import '../../../support/web-dom.adapter';

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ComposerActionButton } = await import('../../../../apps/web/src/chat/composer-action-button.component');

const mounts: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];
afterAll(async () => {
  for (const mount of mounts) { mount.root.unmount(); mount.host.remove(); }
  await new Promise((resolve) => setTimeout(resolve, 50));
});

async function renderIn(element: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounts.push({ root, host });
  await act(async () => { root.render(element); });
  return host;
}

test('assistant-ui Slot onClick runs when the HeroUI button is pressed', async () => {
  let clicked = 0;
  const host = await renderIn(createElement(ComposerActionButton, {
    'aria-label': 'Stop',
    onClick: () => { clicked += 1; },
  }, 'Stop'));
  const button = host.querySelector('button[aria-label="Stop"]');
  expect(button).not.toBeNull();
  await act(async () => {
    button!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    button!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(clicked).toBeGreaterThanOrEqual(1);
});
