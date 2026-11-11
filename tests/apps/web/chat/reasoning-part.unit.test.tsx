import { expect, test } from 'bun:test';
import type { ReasoningMessagePartProps } from '@assistant-ui/react';
import '../../../support/web-dom.adapter';

const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ReasoningPart } = await import('../../../../apps/web/src/chat/chat-rail.component');

function part(status: ReasoningMessagePartProps['status'], text = 'weighing the options'): ReasoningMessagePartProps {
  return { type: 'reasoning', text, status };
}

test('reasoning stays open while the model thinks and collapses to a strip when it finishes', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<StrictMode><ReasoningPart {...part({ type: 'running' })}/></StrictMode>);
    });
    const panel = host.querySelector('.chat-reasoning')!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('data-status')).toBe('running');
    expect(panel.textContent).toContain('Thinking…');
    expect(panel.textContent).toContain('weighing the options');

    // A stopped run collapses back to the strip without a reader click.
    await act(async () => {
      root.render(<StrictMode><ReasoningPart {...part({ type: 'incomplete', reason: 'cancelled' }, 'cut short')}/></StrictMode>);
    });
    expect(host.querySelector('.chat-reasoning')?.getAttribute('data-status')).toBe('incomplete');
    expect(host.querySelector('.chat-reasoning')?.textContent).toContain('Reasoning stopped');

    await act(async () => {
      root.render(<StrictMode><ReasoningPart {...part({ type: 'complete' })}/></StrictMode>);
    });
    expect(host.querySelector('.chat-reasoning')?.getAttribute('data-status')).toBe('complete');
    expect(host.querySelector('.chat-reasoning')?.textContent).toContain('Reasoning');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.chat-reasoning-summary')!.click();
    });
    expect(host.querySelector('.chat-reasoning')?.textContent).toContain('weighing the options');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test('reasoning with no text and no run in flight renders nothing', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<StrictMode><ReasoningPart {...part({ type: 'complete' }, '')}/></StrictMode>);
    });
    expect(host.querySelector('.chat-reasoning')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
