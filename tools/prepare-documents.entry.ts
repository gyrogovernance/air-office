import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { ensureDocumentWorkerPython } from '../packages/documents/src/document-worker-python.adapter';

const root = fileURLToPath(new URL('../', import.meta.url));
const workerRoot = join(root, 'workers', 'documents');

/** Prepares the managed documents worker Python environment on this host. */
export function prepareDocumentsWorker(): string {
  const interpreter = ensureDocumentWorkerPython(workerRoot);
  if (!interpreter) {
    throw new Error('Preparing the documents worker requires a real Python 3.11+ interpreter (Windows Store stubs are not usable).');
  }
  return interpreter;
}

/** Freeze the baseline reader on the build host; installed users need no Python. */
export function prepareDocumentsRuntime(): string {
  const output = join(workerRoot, 'dist', `${process.platform}-${process.arch}`);
  const runtime = join(output, 'air-office-documents');
  const executable = join(runtime, `air-office-documents${process.platform === 'win32' ? '.exe' : ''}`);
  const sources = join(workerRoot, 'src', 'office_documents');
  const dependencies = ['pypdfium2==5.14.0', 'pyinstaller==6.22.3'];
  const fingerprint = createHash('sha256').update(dependencies.join('\n'));
  for (const name of readdirSync(sources).filter((name) => name.endsWith('.py')).sort()) fingerprint.update(name).update(readFileSync(join(sources, name)));
  const digest = fingerprint.digest('hex');
  const stamp = join(runtime, 'build-fingerprint.txt');
  if (existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return runtime;
  const python = Bun.env.OFFICE_PYTHON ?? Bun.which('python') ?? Bun.which('python3');
  if (!python) throw new Error('Building the documents runtime requires Python on the build host.');
  const run = (command: string[]): void => {
    const result = Bun.spawnSync(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
    if (result.exitCode !== 0) throw new Error('The bundled documents runtime could not be prepared.');
  };
  const environment = join(workerRoot, '.runtime-venv');
  const builder = join(environment, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  if (!existsSync(builder)) run([python, '-m', 'venv', environment]);
  run([builder, '-m', 'pip', 'install', ...dependencies]);
  const build = join(workerRoot, 'build', 'runtime');
  mkdirSync(build, { recursive: true });
  const entry = join(build, 'documents_runtime.py');
  writeFileSync(entry, 'from office_documents.main import run\nraise SystemExit(run())\n');
  run([builder, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'air-office-documents', '--paths', join(workerRoot, 'src'), '--collect-all', 'pypdfium2', '--distpath', output, '--workpath', build, '--specpath', build, entry]);
  writeFileSync(stamp, digest);
  return runtime;
}

if (import.meta.main) console.info(`Documents worker Python ready at ${prepareDocumentsWorker()}`);
