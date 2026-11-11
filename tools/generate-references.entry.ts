import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import catalog from './third-party.catalog.json';

const root = join(import.meta.dir, '..');
const output = join(root, 'apps/web/public/licenses');
mkdirSync(output, { recursive: true });
for (const item of catalog.packages) {
  const directories = ['node_modules', 'apps/desktop/node_modules', 'apps/service/node_modules', 'apps/web/node_modules', 'packages/editor/node_modules', 'packages/providers/node_modules'].map((base) => join(root, base, item.name));
  const source = directories.flatMap((base) => ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].map((name) => join(base, name))).find(existsSync);
  if (!source) throw new Error(`License text is missing for ${item.name}.`);
  const filename = item.name.replaceAll('/', '__').replaceAll('@', '') + '.txt';
  writeFileSync(join(output, filename), readFileSync(source));
}
const notices = readFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const target = join(root, 'apps/web/src/market/references.catalog.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({ notices }, null, 2) + '\n');

for (const filename of ['lemonade-Apache-2.0.txt']) writeFileSync(join(output, filename), readFileSync(join(root, 'assets/licenses', filename)));

