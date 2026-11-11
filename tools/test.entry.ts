/**
 * The repository test runner.
 *
 * Every test lives in the single `tests/` tree, mirrored after the product
 * layout: `tests/<base>/<owner>/...` owns the tests of `<base>/<owner>`.
 *
 * The web suite registers a document for the tests that render into it. That
 * registration replaces global objects for the whole process, so the web
 * suite runs on its own and the service and package suites run on theirs.
 * Without the split, a web test would meet a replaced `Response` in a package
 * test and report a failure that has nothing to do with the code.
 *
 * The service suite shares one spawned service process across its integration
 * files, so it runs with a concurrency of one.
 *
 * Usage: `bun run test` runs everything. `bun run test web`, `bun run test
 * service` or `bun run test packages` runs one suite.
 */
import { spawn } from 'node:child_process';

const root = process.cwd();

type Suite = { name: string; paths: string[]; maxConcurrency?: number };

const suites: Suite[] = [
  { name: 'web', paths: ['tests/apps/web'] },
  { name: 'service', paths: ['tests/apps/service'], maxConcurrency: 1 },
  { name: 'packages', paths: ['tests/packages'] },
  { name: 'desktop', paths: ['tests/apps/desktop'] },
  { name: 'office-cli', paths: ['tests/tools/office-cli'] },
];

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
const chosen = requested.length > 0 ? suites.filter((suite) => requested.includes(suite.name)) : suites;
if (chosen.length === 0) {
  console.error(`Unknown suite. Choose from: ${suites.map((suite) => suite.name).join(', ')}.`);
  process.exit(2);
}

const run = (suite: Suite) => new Promise<number>((resolve) => {
  const args = ['test', ...suite.paths];
  if (suite.maxConcurrency !== undefined) args.push(`--max-concurrency=${suite.maxConcurrency}`);
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  child.on('close', (code) => resolve(code ?? 1));
});

let failed = false;
for (const suite of chosen) {
  console.log(`\n=== ${suite.name} ===`);
  const code = await run(suite);
  if (code !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
