import { expect, test } from 'bun:test';
import { chromium } from 'playwright';

test.skipIf(!process.env.OFFICE_DIALOG_TEST_URL)('app dialogs preserve prompt values, trap focus, cancel, restore focus and queue requests', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.OFFICE_DIALOG_TEST_URL!);
    await page.evaluate(async () => {
      const load = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;
      const reactModule = await load('/node_modules/.vite/deps/react.js');
      const React = (reactModule.default ?? reactModule) as typeof import('react');
      const clientModule = await load('/node_modules/.vite/deps/react-dom_client.js');
      const { createRoot } = (clientModule.default ?? clientModule) as typeof import('react-dom/client');
      const { AppDialogsProvider, useAppDialogs } = await load('/src/shared/app-dialogs.component.tsx') as typeof import('../../../apps/web/src/shared/app-dialogs.component');
      const host = document.createElement('div');
      document.body.append(host);
      function Harness() {
        const dialogs = useAppDialogs();
        return React.createElement('button', { id: 'dialog-test-trigger', onClick: async () => {
          const name = dialogs.prompt({ title: 'Name the document', label: 'Name', initialValue: 'Initial name', submitLabel: 'Create' });
          const approved = dialogs.confirm({ title: 'Delete document?', message: 'This document will be deleted.', confirmLabel: 'Delete', destructive: true });
          Object.assign(window, { dialogTestResult: [await name, await approved] });
        } }, 'Test dialogs');
      }
      createRoot(host).render(React.createElement(AppDialogsProvider, null, React.createElement(Harness)));
    });
    const trigger = page.locator('#dialog-test-trigger');
    await trigger.click();
    const dialog = page.locator('.app-dialog');
    await dialog.waitFor({ state: 'visible' });
    expect(await dialog.locator('input').inputValue()).toBe('Initial name');
    expect(await dialog.locator('input').evaluate((node) => node === document.activeElement)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await dialog.getByRole('button', { name: 'Create' }).evaluate((node) => node === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await dialog.locator('input').evaluate((node) => node === document.activeElement)).toBe(true);
    await dialog.locator('input').fill('A new name');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await dialog.getByRole('heading', { name: 'Delete document?' }).waitFor();
    expect(await dialog.getByRole('button', { name: 'Cancel' }).evaluate((node) => node === document.activeElement)).toBe(true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => Reflect.get(window, 'dialogTestResult'))).toEqual(['A new name', false]);
    expect(await trigger.evaluate((node) => node === document.activeElement)).toBe(true);
    await trigger.click();
    await dialog.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await dialog.getByRole('heading', { name: 'Delete document?' }).waitFor();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => Reflect.get(window, 'dialogTestResult'))).toEqual([null, true]);
  } finally {
    await browser.close();
  }
}, 30000);
