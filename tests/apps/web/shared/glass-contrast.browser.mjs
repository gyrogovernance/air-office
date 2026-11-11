import { chromium, firefox, webkit, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const engine = process.env.GLASS_BROWSER ?? 'chromium';
const browserType = { chromium, firefox, webkit }[engine];
if (!browserType) throw new Error('Unknown GLASS_BROWSER');
const output = `verification/glass-contrast/${engine}`;
await mkdir(output, { recursive: true });
const browser = await browserType.launch({ headless: true, firefoxUserPrefs: { 'ui.prefersReducedTransparency': 0 } });
const observations = [], errors = [];
try {
  for (const width of [853, 1920]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 968 } });
      const page = await context.newPage();
      const media = engine === 'chromium' ? await context.newCDPSession(page) : null;
      await media?.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
      await page.addInitScript((value) => localStorage.setItem('air-office:theme', value), theme);
      await page.route('http://127.0.0.1:4317/**', (route) => {
        const request = route.request();
        if (['GET', 'OPTIONS'].includes(request.method()) || new URL(request.url()).pathname === '/bootstrap') return route.continue();
        return route.fulfill({ status: 409, json: { error: 'Read-only visual verification.' } });
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:5173/#/chat/${process.env.GLASS_CHAT_ID ?? 'demo-research-oversight'}`);
      await expect(page.locator('.ui-frost-scrim')).toHaveCount(1);
      expect(await page.locator('.shell-top-frost').boundingBox()).toMatchObject({ x: 0, y: 0, width, height: 96 });
      await page.getByRole('tab', { name: 'Assistance', exact: true }).click();
      const profile = page.locator('.sidebar-profile');
      await expect(profile).toBeVisible();
      await expect.poll(() => profile.evaluate((e) => [e.clientWidth, e.clientHeight])).toEqual([38, 38]);
      const cards = page.locator('.assistance-widget');
      await expect(cards).toHaveCount(2);
      const gradients = await cards.evaluateAll((elements) => elements.map((e) => getComputedStyle(e).backgroundImage));
      expect(gradients.every((value) => value.includes('linear-gradient'))).toBe(true);
      const fills = await page.locator('.rail-right-scene .ui-frost.lg-tabs-list, .sidebar-profile-toolbar > .lg-toolbar-cluster').evaluateAll((elements) => elements.map((e) => getComputedStyle(e).backgroundColor));
      expect(new Set(fills).size).toBe(1);
      expect(fills[0]).not.toBe('rgba(0, 0, 0, 0)');
      const tracks = page.locator('.workspace-tabs-icons .lg-tabs-list');
      const materials = await tracks.evaluateAll((elements) => elements.map((e) => ({
        fill: getComputedStyle(e).backgroundColor,
        blur: getComputedStyle(e).backdropFilter,
        selection: getComputedStyle(e.querySelector('.ui-frost-selection')).backgroundColor,
      })));
      expect(new Set(materials.map((m) => m.fill)).size).toBe(1);
      expect(new Set(materials.map((m) => m.selection)).size).toBe(1);
      expect(await profile.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(materials[0].selection);
      expect(materials.every((m) => m.blur === 'blur(20px) saturate(1.8)')).toBe(true);
      // Exercise the adapter against both renderer paint mechanisms.
      await tracks.first().evaluate((e) => {
        e.style.backdropFilter = 'url("#sdk-test")';
        e.style.filter = 'url("#sdk-test")';
        const layer = document.createElement('div');
        layer.className = 'lg-glass-layer';
        layer.dataset.probe = 'true';
        e.append(layer);
      });
      expect(await tracks.first().evaluate((e) => ({ blur: getComputedStyle(e).backdropFilter, filter: getComputedStyle(e).filter, layer: getComputedStyle(e.querySelector('[data-probe]')).display }))).toEqual({ blur: 'blur(20px) saturate(1.8)', filter: 'none', layer: 'none' });
      await tracks.first().evaluate((e) => { e.style.removeProperty('backdrop-filter'); e.style.removeProperty('filter'); e.querySelector('[data-probe]').remove(); });
      for (let attempt = 0; attempt < 2; attempt++) {
        await profile.click();
        await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
        await expect.poll(() => profile.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
        await expect.poll(() => profile.locator('svg').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
        await page.keyboard.press('Escape');
        await expect(profile).toBeFocused();
      }
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${output}/${width}-${theme}-directory.png` });
      await page.getByRole('tab', { name: 'Chat', exact: true }).click();
      const branches = page.getByRole('tab', { name: 'Branches', exact: true });
      await branches.click();
      await expect(branches).toHaveAttribute('aria-selected', 'true');
      const selection = await branches.locator('..').locator('.lg-tab-indicator').evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(selection).not.toBe('rgba(0, 0, 0, 0)');
      await page.getByRole('tab', { name: 'Threads', exact: true }).click();
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${output}/${width}-${theme}-chat.png` });
      const track = page.locator('.sidebar-navigation-right .lg-tabs-list');
      await track.evaluate((e) => {
        const edge = document.createElement('div');
        edge.id = 'frost-edge-probe';
        Object.assign(edge.style, { position: 'absolute', inset: '-30px', background: 'linear-gradient(to bottom,white 50%,black 50%)', zIndex: '-1' });
        e.parentElement.prepend(edge);
      });
      const blurred = await track.screenshot({ path: `${output}/${width}-${theme}-edge-blurred.png` });
      const override = await page.addStyleTag({ content: '.sidebar-navigation-right .lg-tabs-list { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
      const sharp = await track.screenshot({ path: `${output}/${width}-${theme}-edge-sharp.png` });
      const edgeContrast = await page.evaluate(async (images) => {
        const values = [];
        for (const data of images) {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);
          const y = Math.floor(image.height / 2);
          const pixels = ctx.getImageData(image.width - 8, y - 2, 1, 5).data;
          values.push(Math.abs(pixels[0] - pixels[16]));
        }
        return values;
      }, [blurred.toString('base64'), sharp.toString('base64')]);
      expect(edgeContrast[1]).toBeGreaterThan(30);
      expect(edgeContrast[0]).toBeLessThan(edgeContrast[1] / 2);
      await override.evaluate((e) => e.remove());
      await page.locator('#frost-edge-probe').evaluate((e) => e.remove());
      await media?.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      const reduced = await profile.evaluate((e) => getComputedStyle(e.closest('.lg-toolbar-cluster')).backgroundColor);
      if (media) expect(reduced).not.toBe(fills[0]);
      observations.push({ width, theme, gradients, fills, edgeContrast, reducedTransparencyTested: !!media, profile: [38, 38], menuReopens: 2, reduced });
      await context.close();
    }
  }
  expect(errors).toEqual([]);
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: true, observations, errors }, null, 2));
  console.log(`${engine}: CSS blur including sharp edges, equal switch/profile fills, gradients, geometry, tab selection and menu focus pass at both widths and themes. Reduced-transparency switching is tested in Chromium.`);
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ passed: false, engine, error: String(error), observations, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
