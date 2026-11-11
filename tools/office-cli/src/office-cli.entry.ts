import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';
import { analyzeImportBoundaries } from './import-boundary.analyzer';
import { checkStyles } from './style-check.command';
import { runSecurity } from './security.command';
import { runVaultMigrate } from './vault-migrate.command';
import { printCliBanner } from '../../cli-banner';

const root = resolve(import.meta.dir, '../../..');
const args = Bun.argv.slice(2);
const command = args[0] ?? 'help';
if (command === 'help') printCliBanner();
const modules = ['contracts', 'runtime', 'vault', 'workspace', 'files', 'editor', 'providers', 'chat', 'documents', 'knowledge', 'jobs', 'tools', 'calendar', 'automations', 'ui-kit', 'memory'];
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'code-server') return Promise.resolve([]);
      return sourceFiles(join(directory, entry.name));
    }
    return Promise.resolve([join(directory, entry.name)]);
  }));
  return nested.flat();
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function validateManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['must be an object'];
  const required = ['schema_version', 'id', 'title', 'purpose', 'kind', 'lifecycle', 'ownership', 'entrypoints', 'foundation_dependencies', 'required_ports', 'contracts', 'events', 'feature_ids', 'scenario_ids', 'documentation'];
  for (const key of required) if (!(key in value)) errors.push(`missing required property ${key}`);
  for (const key of Object.keys(value)) if (!required.includes(key)) errors.push(`unknown property ${key}`);
  const name = (item: unknown): item is string => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 128 || !/^[a-z]/.test(item)) return false;
    let previousWasSeparator = false;
    for (const character of item) {
      if (character === '-') {
        if (previousWasSeparator) return false;
        previousWasSeparator = true;
      } else {
        if (!/[a-z0-9]/.test(character)) return false;
        previousWasSeparator = false;
      }
    }
    return !previousWasSeparator;
  };
  const path = (item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 512 && !item.startsWith('/') && !item.includes('\\') && !/(^|\/)\.\.(\/|$)/.test(item) && !/^[A-Za-z]:/.test(item);
  const strings = (item: unknown, key: string, isValid?: (value: string) => boolean) => {
    if (!Array.isArray(item) || item.some((v) => typeof v !== 'string' || (isValid && !isValid(v)))) errors.push(`${key} must be a valid string array`);
    else if (new Set(item).size !== item.length) errors.push(`${key} must contain unique items`);
  };
  if (value.schema_version !== 1) errors.push('schema_version must equal 1');
  if (!name(value.id)) errors.push('id must match name pattern');
  if (typeof value.title !== 'string' || !value.title.length) errors.push('title must be non-empty');
  if (typeof value.purpose !== 'string' || value.purpose.length < 20) errors.push('purpose must have at least 20 characters');
  if (value.kind !== 'capability' && value.kind !== 'foundation') errors.push('kind is invalid');
  if (!['scaffold', 'active', 'deprecated'].includes(String(value.lifecycle))) errors.push('lifecycle is invalid');
  if (isRecord(value.ownership)) {
    for (const key of Object.keys(value.ownership)) if (!['entities', 'table_prefixes'].includes(key)) errors.push(`unknown ownership property ${key}`);
    if (!('entities' in value.ownership) || !('table_prefixes' in value.ownership)) errors.push('ownership requires entities and table_prefixes');
    strings(value.ownership.entities, 'ownership.entities', name);
    strings(value.ownership.table_prefixes, 'ownership.table_prefixes', (item) => /^[a-z][a-z0-9]*_$/.test(item));
  } else errors.push('ownership must be an object');
  if (isRecord(value.entrypoints)) {
    const keys = Object.keys(value.entrypoints);
    if (!keys.length || keys.some((key) => !['domain', 'service', 'ui', 'host'].includes(key))) errors.push('entrypoints must contain recognized keys');
    for (const [key, item] of Object.entries(value.entrypoints)) {
      const entryPath = typeof item === 'string' && item.length <= 512 ? item : '';
      const validDefault = (key === 'domain' && /^src\/[a-z0-9/-]+\.domain\.public\.ts$/.test(entryPath)
        || key === 'service' && /^src\/[a-z0-9/-]+\.service\.public\.ts$/.test(entryPath)
        || key === 'ui' && /^src\/[a-z0-9/-]+\.ui\.public\.ts$/.test(entryPath)
        || key === 'host' && /^src\/[a-z0-9/-]+\.host\.public\.ts$/.test(entryPath));
      const contractSuffix = '.contracts.service.public.ts';
      const contractSegments = entryPath.startsWith('src/') && entryPath.endsWith(contractSuffix)
        ? entryPath.slice(4, -contractSuffix.length).split('/')
        : [];
      const validContracts = value.id === 'contracts' && key === 'service' && contractSegments.length > 0 && contractSegments.every((segment) => name(segment));
      if (!path(item) || !validDefault && !validContracts) errors.push(`entrypoints.${key} is invalid`);
    }
  } else errors.push('entrypoints must be an object');
  strings(value.foundation_dependencies, 'foundation_dependencies');
  if (Array.isArray(value.foundation_dependencies) && value.foundation_dependencies.some((v) => !['contracts', 'ui-kit', 'runtime', 'test-kit'].includes(String(v)))) errors.push('foundation_dependencies contains an invalid value');
  strings(value.required_ports, 'required_ports', name); strings(value.contracts, 'contracts', name);
  if (isRecord(value.events)) {
    if (Object.keys(value.events).some((k) => !['emits', 'consumes'].includes(k)) || !('emits' in value.events) || !('consumes' in value.events)) errors.push('events must have only emits and consumes');
    strings(value.events.emits, 'events.emits', name); strings(value.events.consumes, 'events.consumes', name);
  } else errors.push('events must be an object');
  strings(value.feature_ids, 'feature_ids', (item) => /^F-[0-9]{3}$/.test(item));
  strings(value.scenario_ids, 'scenario_ids', (item) => /^[AT]-[0-9]{3}$/.test(item));
  if (!Array.isArray(value.documentation) || value.documentation.length < 1 || value.documentation.some((v) => !path(v))) errors.push('documentation must contain relative paths');
  else if (new Set(value.documentation).size !== value.documentation.length) errors.push('documentation must contain unique items');
  return errors;
}
async function check() {
  const issues: string[] = [];
  for (const packageId of modules) {
    const directory = join(root, 'packages', packageId);
    const raw: unknown = JSON.parse(await readFile(join(directory, 'module.manifest.json'), 'utf8'));
    for (const error of validateManifest(raw)) issues.push(`${packageId}: manifest ${error}`);
    if (!isRecord(raw) || !isRecord(raw.entrypoints) || !isRecord(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')))) continue;
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { exports?: Record<string, string> };
    for (const target of Object.values(raw.entrypoints)) if (typeof target === 'string' && !await Bun.file(join(directory, target)).exists()) issues.push(`${packageId}: missing ${target}`);
    for (const target of Object.values(pkg.exports ?? {})) if (!await Bun.file(join(directory, target)).exists()) issues.push(`${packageId}: export target missing ${target}`);
  }
  const owners = new Map<string, string>();
  for (const packageId of modules) {
    const raw: unknown = JSON.parse(await readFile(join(root, 'packages', packageId, 'module.manifest.json'), 'utf8'));
    if (!isRecord(raw) || !isRecord(raw.ownership) || !Array.isArray(raw.ownership.entities)) continue;
    for (const entity of raw.ownership.entities) if (typeof entity === 'string') { if (owners.has(entity)) issues.push(`duplicate entity owner ${entity}`); owners.set(entity, packageId); }
  }
  const roleCatalog = JSON.parse(await readFile(join(root, 'tools/role.catalog.json'), 'utf8')) as { typescript_subject_pattern: string; forbidden_subjects: string[]; roles: { id: string }[] };
  const roleIds = roleCatalog.roles.map((role) => role.id).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(roleCatalog.typescript_subject_pattern);
  for (const base of ['apps', 'packages', 'tools', 'tests']) for (const file of await sourceFiles(join(root, base))) {
    const rel = relative(root, file).split(sep).join('/');
    if (!/\.(ts|tsx)$/.test(file) || file.endsWith('.d.ts')) continue;
    if (file.endsWith('import-boundary.analyzer.ts')) continue;
    const name = file.split(sep).at(-1)!;
    if (name === 'vite.config.ts' || name === 'electron.vite.config.ts') continue;
    const role = roleIds.find((item) => name.endsWith(`.${item}.ts`) || name.endsWith(`.${item}.tsx`));
    if (!role) { issues.push(`${rel}: filename has no allowed role`); continue; }
    const subject = role === 'public' ? name.slice(0, -'.public.ts'.length).split('.').slice(0, -1).join('-') : role === 'unit.test' ? name.slice(0, -(role.length + (name.endsWith('.tsx') ? 5 : 4))).replaceAll('.', '-') : name.slice(0, -(role.length + (name.endsWith('.tsx') ? 5 : 4)));
    if (!pattern.test(subject) || roleCatalog.forbidden_subjects.includes(subject)) issues.push(`${rel}: invalid source subject`);
  }
  const sourceRecords: { fileName: string; source: string }[] = [];
  const packages: { name: string; root: string; exports: Record<string, string>; dependencies: string[] }[] = [];
  for (const base of ['packages', 'apps', 'tools']) for (const entry of await readdir(join(root, base), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, base, entry.name);
    const packagePath = join(directory, 'package.json');
    if (await Bun.file(packagePath).exists()) {
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { name?: string; exports?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      if (pkg.name) packages.push({ name: pkg.name, root: directory, exports: pkg.exports ?? {}, dependencies: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})] });
    }
    for (const file of await sourceFiles(join(directory, 'src'))) if (/\.(ts|tsx)$/.test(file) && !file.endsWith('.d.ts')) sourceRecords.push({ fileName: file, source: await readFile(file, 'utf8') });
  }
  // The tests/ tree mirrors the product layout: tests/<base>/<owner>/... owns
  // the tests of the module at <base>/<owner>. That mapping is what lets the
  // analyzer allow a test to reach into its own module's internals.
  const testOwners: Record<string, string> = {};
  for (const base of ['apps', 'packages', 'tools']) {
    const baseRoot = join(root, 'tests', base);
    for (const entry of await readdir(baseRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const ownerDirectory = join(root, base, entry.name);
      const packagePath = join(ownerDirectory, 'package.json');
      if (!await Bun.file(packagePath).exists()) continue;
      const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { name?: string };
      if (pkg.name) testOwners[`${base}/${entry.name}`] = pkg.name;
    }
  }
  for (const file of await sourceFiles(join(root, 'tests'))) {
    if (!/\.(ts|tsx)$/.test(file) || file.endsWith('.d.ts')) continue;
    if (file.includes(`${sep}support${sep}`)) continue;
    sourceRecords.push({ fileName: file, source: await readFile(file, 'utf8') });
  }
  for (const issue of analyzeImportBoundaries(sourceRecords, packages, { testsRoot: join(root, 'tests'), owners: testOwners })) issues.push(`${relative(root, issue.fileName).split(sep).join('/')}: ${issue.ruleId}: ${issue.message}`);
  return issues;
}
async function checkThirdPartyCatalog(): Promise<string[]> {
  const issues: string[] = [];
  const catalogPath = join(root, 'tools/third-party.catalog.json');
  const noticesPath = join(root, 'THIRD-PARTY-NOTICES.md');
  if (!await Bun.file(catalogPath).exists()) return ['third-party catalog: tools/third-party.catalog.json is missing'];
  let catalog: unknown;
  try { catalog = JSON.parse(await readFile(catalogPath, 'utf8')); } catch (error) { return [`third-party catalog: not parseable JSON (${error instanceof Error ? error.message : String(error)})`]; }
  if (!isRecord(catalog) || !Array.isArray(catalog.allowed_licenses) || !Array.isArray(catalog.packages)) return ['third-party catalog: requires allowed_licenses and packages arrays'];
  const allowed = new Set(catalog.allowed_licenses.map(String));
  const notices = await Bun.file(noticesPath).exists() ? await readFile(noticesPath, 'utf8') : null;
  if (notices === null) issues.push('third-party notices: THIRD-PARTY-NOTICES.md is missing');
  const referencesPath = join(root, 'apps/web/src/market/references.catalog.json');
  if (notices !== null) {
    if (!await Bun.file(referencesPath).exists()) issues.push('third-party notices: apps/web/src/market/references.catalog.json is missing');
    else {
      try {
        const references = JSON.parse(await readFile(referencesPath, 'utf8')) as { notices?: unknown };
        if (typeof references.notices !== 'string' || references.notices !== notices) {
          issues.push('third-party notices: apps/web/src/market/references.catalog.json notices must match THIRD-PARTY-NOTICES.md exactly');
        }
      } catch (error) {
        issues.push(`third-party notices: references.catalog.json is not parseable JSON (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
  const searchRoots = [join(root, 'node_modules')];
  for (const base of ['packages', 'apps', 'tools']) for (const directory of await readdir(join(root, base)).catch(() => [])) searchRoots.push(join(root, base, directory, 'node_modules'));
  searchRoots.push(join(root, 'tests', 'node_modules'));
  for (const entry of catalog.packages as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string' || typeof entry.license !== 'string') { issues.push('third-party catalog: every entry needs name, exact version and license strings'); continue; }
    const label = `${entry.name}@${entry.version}`;
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(entry.version)) issues.push(`third-party catalog: ${label} must pin an exact version, not a range`);
    if (!allowed.has(entry.license)) issues.push(`third-party catalog: ${label} uses license ${entry.license}, which is not on the allowlist`);
    if (typeof entry.source !== 'string' || !entry.source.startsWith('https://registry.npmjs.org/')) issues.push(`third-party catalog: ${label} must cite its npm registry source`);
    if (typeof entry.purpose !== 'string' || entry.purpose.length < 20) issues.push(`third-party catalog: ${label} needs a purpose of at least 20 characters`);
    if (typeof entry.queue !== 'string' || !entry.queue.length) issues.push(`third-party catalog: ${label} must name its queue item`);
    if (typeof entry.adopted !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.adopted)) issues.push(`third-party catalog: ${label} must record an adoption date`);
    if (notices !== null && (!notices.includes(entry.name) || !notices.includes(entry.license))) issues.push(`third-party notices: ${label} is missing from THIRD-PARTY-NOTICES.md`);
    const segments = entry.name.split('/');
    let installedPath: string | null = null;
    for (const candidateRoot of searchRoots) {
      const candidate = join(candidateRoot, ...segments, 'package.json');
      if (await Bun.file(candidate).exists()) { installedPath = candidate; break; }
    }
    if (installedPath === null) { issues.push(`third-party catalog: ${label} is not installed in any workspace package`); continue; }
    const installed = JSON.parse(await readFile(installedPath, 'utf8')) as { version?: unknown; license?: unknown };
    if (installed.version !== entry.version) issues.push(`third-party catalog: ${label} but the installed version is ${String(installed.version)}`);
    if (installed.license !== entry.license) issues.push(`third-party catalog: ${label} declares license ${entry.license} but the installed package reports ${String(installed.license)}`);
    const packageDirectory = dirname(installedPath);
    const licenseFiles = await Promise.all(['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT'].map((name) => Bun.file(join(packageDirectory, name)).exists()));
    // Some npm packages declare an SPDX license in package.json without shipping a
    // LICENSE file. Catalog + notices already record the license; require a file
    // only when package.json itself omits the license field.
    if (!licenseFiles.some(Boolean) && typeof installed.license !== 'string') {
      issues.push(`third-party catalog: ${label} ships no LICENSE file next to its package.json`);
    }
  }
  return issues;
}
if (command === 'doctor') {
  console.log(`Bun: ${Bun.version}\nDevelopment UI+service: bun run dev\nWeb UI only: bun run build:web\nProduct desktop package: bun run build:desktop (Windows NSIS: bun run build:desktop:windows)\nDesktop host: Electron (electron-builder)\nRelease path: prepare-desktop-artifact compiles the Bun service sidecar, then packaging wraps host + UI + resources\nDocument worker (Python): ${Bun.which('python') ?? Bun.which('python3') ? 'interpreter available; run workers/documents tests with pytest' : 'not installed'}`);
} else if (command === 'impact') {
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  if (!base) { console.error('Usage: office impact --base <git-ref>'); process.exitCode = 2; }
  else {
    const result = await new Promise<{ code: number | null; output: string }>((resolveResult) => {
      const child = spawn('git', ['diff', '--name-only', base, '--'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; }); child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; }); child.on('error', (error) => resolveResult({ code: 1, output: error.message })); child.on('close', (code) => resolveResult({ code, output }));
    });
    if (result.code !== 0) { console.error(`Could not inspect git base ${base}: ${result.output.trim()}`); process.exitCode = 1; }
    else {
      const changed = result.output.trim() ? result.output.trim().split(/\r?\n/) : [];
      const modules = [...new Set(changed.map((file) => file.match(/^packages\/([^/]+)/)?.[1] ?? file.match(/^apps\/([^/]+)/)?.[1] ?? file.match(/^tools\/([^/]+)/)?.[1]).filter(Boolean))];
      console.log(`Impact from ${base}`); console.log(`Changed files: ${changed.length}`); console.log(`Affected modules: ${modules.join(', ') || 'none detected'}`); console.log('Required checks: office check --changed; provider/chat tests when contracts, providers, chat, service, or web change.');
    }
  }
} else if (command === 'check') {
  if (!args.includes('--changed') && !args.includes('--all')) { console.error('Usage: office check --changed | --all'); process.exitCode = 2; }
  else {
    const architectureIssues = await check();
    const results: { name: string; status: 'PASS' | 'FAIL' | 'NOT RUN'; detail?: string }[] = [];
    results.push({ name: 'Manifest/schema, exports, ownership, source roles and cross-package imports', status: architectureIssues.length ? 'FAIL' : 'PASS', ...(architectureIssues.length ? { detail: architectureIssues.join('\n') } : {}) });
    const thirdPartyIssues = await checkThirdPartyCatalog();
    results.push({ name: 'Third-party catalog: exact versions, licenses, allowlist, notices and installed files', status: thirdPartyIssues.length ? 'FAIL' : 'PASS', ...(thirdPartyIssues.length ? { detail: thirdPartyIssues.join('\n') } : {}) });
    const architectureTest = await new Promise<{ code: number | null; output: string }>((resolveResult) => {
      // The architecture contract tests live under tests/, beside the other
      // suites, not beside the checker itself.
      const child = spawn(process.execPath, ['test', 'tests/tools/office-cli'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.on('error', (error) => resolveResult({ code: 1, output: error.message }));
      child.on('close', (code) => resolveResult({ code, output }));
    });
    results.push({ name: 'AST import-boundary and negative architecture contract tests', status: architectureTest.code === 0 ? 'PASS' : 'FAIL', ...(architectureTest.output.trim() ? { detail: architectureTest.output.trim() } : {}) });
    const typecheck = await new Promise<{ code: number | null; output: string }>((resolveResult) => {
      const child = spawn(process.execPath, ['run', '--cwd', root, 'typecheck'], { cwd: root, env: { ...process.env, PATH: [join(root, 'node_modules', '.bin'), process.env.PATH].filter(Boolean).join(delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.on('error', (error) => resolveResult({ code: 1, output: error.message }));
      child.on('close', (code) => resolveResult({ code, output }));
    });
    results.push({ name: 'Root TypeScript typecheck', status: typecheck.code === 0 ? 'PASS' : 'FAIL', ...(typecheck.output.trim() ? { detail: typecheck.output.trim() } : {}) });
    const styleIssues = await checkStyles(root);
    results.push({ name: 'Style hygiene: naming, undefined properties, duplicate classes, import order, unstyled library surfaces', status: styleIssues.length ? 'FAIL' : 'PASS', ...(styleIssues.length ? { detail: styleIssues.map((issue) => `${issue.file}: ${issue.rule}: ${issue.message}`).join('\n') } : {}) });
    for (const result of results) console.log(`${result.name}: ${result.status}${result.detail && result.status !== 'PASS' ? `\\n${result.detail}` : ''}`);
    if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
  }
} else if (command === 'security') {
  try { await runSecurity(args.slice(1)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
} else if (command === 'vault-migrate') {
  try {
    const dryRun = args.includes('--dry-run');
    const rootIndex = args.indexOf('--root');
    const privateIndex = args.indexOf('--private-root');
    await runVaultMigrate({
      dryRun,
      ...(rootIndex >= 0 && args[rootIndex + 1] ? { root: args[rootIndex + 1] } : {}),
      ...(privateIndex >= 0 && args[privateIndex + 1] ? { privateRoot: args[privateIndex + 1] } : {}),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else if (command === 'vault-check-legacy') {
  const patterns = [
    'TOOL_ARGUMENT_ALIASES',
    'createSqliteRichDocumentStore',
    'createSqliteCalendarStore',
    'createSqliteAutomationStore',
    'createSqliteMemoryStore',
    'createSqliteWorkspaceStore',
    'createSqliteConversationStore',
    'createSqliteMethodsStore',
    "fileId: ['noteId",
    'old_string',
  ];
  const allow = new Set([
    'tools/office-cli/src/office-cli.entry.ts',
    'tools/office-cli/src/vault-migrate.command.ts',
    // Retirement maps keep former ids so chat selections migrate once.
    'packages/tools/src/tools.domain.public.ts',
  ]);
  const hits: string[] = [];
  const scopes = [
    'packages/*/src/**/*.ts',
    'apps/*/src/**/*.ts',
    'apps/*/src/**/*.tsx',
    'tools/office-cli/src/**/*.ts',
  ];
  for (const patternGlob of scopes) {
    const glob = new Bun.Glob(patternGlob);
    for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
      const normalized = file.replace(/\\/g, '/');
      if (allow.has(normalized)) continue;
      const text = await Bun.file(join(root, normalized)).text();
      for (const pattern of patterns) {
        if (text.includes(pattern)) hits.push(`${normalized}: ${pattern}`);
      }
    }
  }
  if (hits.length) {
    console.error('Legacy vault cutover residues found:');
    for (const hit of hits) console.error(hit);
    process.exitCode = 1;
  } else {
    console.log('vault-check-legacy: no legacy adapter/alias residues found.');
  }
} else { console.log('Commands: impact --base <git-ref>, doctor, check --changed, check --all, security [--full | --record-pins], vault-migrate [--dry-run] [--root <path>] [--private-root <path>], vault-check-legacy'); }
