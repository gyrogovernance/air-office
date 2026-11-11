import { expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ChatToolCall } = await import('../../../../apps/web/src/chat/chat-tool-call.component');

test('search stays one quiet row until opened, and fetch never repeats the host or dumps HTML', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatToolCall toolName="web_search" args={{ query: 'research' }} result={{ results: [
      { url: 'https://example.org/paper', title: 'Research paper', snippet: 'An available result.' },
      { url: 'javascript:alert(1)', title: 'Unsafe link', snippet: 'Blocked' },
      { url: 'https://example.org/second', title: 'Second result', snippet: 'x'.repeat(300) },
      { url: 'https://example.org/third', title: 'Third result', snippet: 'Additional research' },
    ] }}/>));
    expect(host.textContent).toContain('Search');
    expect(host.textContent).toContain('research');
    expect(host.textContent).toContain('3');
    expect(host.querySelectorAll('.chat-search-card').length).toBe(0);
    expect(host.textContent).not.toContain('Unsafe link');
    expect(host.querySelector('pre')).toBeNull();
    expect(host.textContent).not.toContain('Done');
    expect(host.textContent).not.toContain('could not complete');
    const more = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('3'));
    if (!more) throw new Error('Missing results disclosure');
    await act(async () => more.click());
    expect(host.querySelectorAll('.chat-search-card').length).toBe(3);
    expect(host.textContent).toContain('Research paper');
    expect(host.querySelector('a[href="https://example.org/paper"]')).toBeTruthy();

    await act(async () => root.render(<ChatToolCall toolName="web_fetch" result={{ kind: 'web-page', url: 'https://www.example.org/opened', title: 'www.example.org', content: '<!doctype html><html><body>secret markup</body></html>' }}/>));
    expect(host.querySelector('a[href="https://www.example.org/opened"]')).toBeTruthy();
    expect(host.textContent).toContain('Opened');
    expect(host.textContent).toContain('example.org');
    expect((host.textContent?.match(/example\.org/g) ?? []).length).toBe(1);
    expect(host.textContent).not.toContain('secret markup');
    expect(host.textContent).not.toContain('Open page');
    expect(host.textContent).not.toContain('Done');

    await act(async () => root.render(<ChatToolCall toolName="web_fetch" isError result={{ secret: 'internal diagnostics' }}/>));
    expect(host.textContent).toContain('Failed');
    expect(host.textContent).toContain('Couldn’t load');
    expect(host.textContent).not.toContain('Try another page');
    expect(host.textContent).not.toContain('internal diagnostics');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
