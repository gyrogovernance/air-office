import { afterAll, expect, spyOn, test } from 'bun:test';
const { openConnectorSignIn } = await import('../../../apps/web/src/tools/connector-browser.adapter');

test('browser consent uses the reserved window', async () => {
  const target = { location: { href: 'about:blank' } } as Window;
  await openConnectorSignIn('https://identity.example/authorize?state=example', target);
  expect(target.location.href).toBe('https://identity.example/authorize?state=example');
});

test('browser consent opens a detached window without treating noopener as a blocked popup', async () => {
  const target = { location: { href: 'about:blank' }, opener: window, closed: false } as unknown as Window;
  const open = spyOn(window, 'open').mockReturnValue(target);
  try {
    await openConnectorSignIn('https://identity.example/authorize?state=example');
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(target.opener).toBeNull();
    expect(target.location.href).toBe('https://identity.example/authorize?state=example');
  } finally { open.mockRestore(); }
});

test('browser consent reports blocked popups', async () => {
  const open = spyOn(window, 'open').mockReturnValue(null);
  try { await expect(openConnectorSignIn('https://identity.example/authorize')).rejects.toThrow('Allow browser pop-ups'); }
  finally { open.mockRestore(); }
});

test('browser consent rejects unsafe addresses before opening them', async () => {
  const open = spyOn(window, 'open');
  try {
    for (const url of ['javascript:alert(1)', 'file:///example', 'http://identity.example/authorize', 'https://user:secret@identity.example/authorize', 'https://identity.example/#token']) {
      await expect(openConnectorSignIn(url)).rejects.toThrow();
    }
    expect(open).not.toHaveBeenCalled();
  } finally { open.mockRestore(); }
});
