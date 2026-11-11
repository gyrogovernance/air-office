import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const host = readFileSync(
  join(import.meta.dir, '..', '..', '..', '..', 'apps', 'desktop', 'src', 'main', 'paths.ts'),
  'utf8'
);

test('packaged host resolves the Bun sidecar next to itself or under resources', () => {
  expect(host).toContain('bundledServiceExecutable');
  expect(host).toContain('air-office-service');
  expect(host).toContain('process.resourcesPath');
});
