import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { LocalAiRuntimeUpdate } from '../../../apps/web/src/models/local-ai/local-ai-runtime-update.component';

test('runtime update controls stay desktop-only without airDesktop', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<LocalAiRuntimeUpdate />);
  });
  expect(host.textContent ?? '').toContain('desktop application');
  await act(async () => root.unmount());
  host.remove();
});
