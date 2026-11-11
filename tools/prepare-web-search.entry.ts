import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const worker = join(root, 'workers', 'web-search');

/** Build on the target host. Installed users receive this complete runtime. */
export function prepareWebSearchWorker(): string {
  const output = join(worker, 'dist', `${process.platform}-${process.arch}`);
  const runtime = join(output, 'air-office-web-search');
  const executable = join(runtime, 'air-office-web-search' + (process.platform === 'win32' ? '.exe' : ''));
  const entry = join(worker, 'src', 'office_web_search', 'main.py');
  const requirements = join(worker, 'requirements.txt');
  const fingerprint = createHash('sha256').update(readFileSync(entry)).update(readFileSync(requirements)).update(readFileSync(join(root, '.vendor', 'primp-2.0.1-air.1.tar.gz'))).update('pyinstaller-6.22.3').digest('hex');
  const stamp = join(runtime, 'build-fingerprint.txt');
  if (existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) return runtime;
  const python = Bun.env.OFFICE_PYTHON ?? Bun.which('python') ?? Bun.which('python3');
  if (!python) throw new Error('Building the bundled search engine requires Python on the build host. Installed users do not need Python.');
  const run = (command: string[]) => {
    const result = Bun.spawnSync(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
    if (result.exitCode !== 0) throw new Error('The bundled search engine could not be prepared.');
  };
  const environment = join(worker, '.venv');
  const builder = join(environment, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
  if (!existsSync(builder)) run([python, '-m', 'venv', environment]);
  const primpSource = join(root, '.vendor', 'primp-2.0.1-air.1.tar.gz');
  const sourceHash = createHash('sha256').update(readFileSync(primpSource)).digest('hex');
  const wheels = join(worker, 'build', 'primp', `${process.platform}-${process.arch}`, sourceHash);
  mkdirSync(wheels, { recursive: true });
  if (!readdirSync(wheels).some((name) => name.endsWith('.whl'))) run([builder, '-m', 'pip', 'wheel', '--no-deps', '--wheel-dir', wheels, primpSource]);
  run([builder, '-m', 'pip', 'install', '--no-index', '--find-links', wheels, 'primp==2.0.1+air.1']);
  run([builder, '-m', 'pip', 'install', '-r', requirements, 'pyinstaller==6.22.3']);
  mkdirSync(join(worker, 'build'), { recursive: true });
  run([builder, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'air-office-web-search', '--collect-all', 'ddgs', '--collect-all', 'primp', '--collect-all', 'lxml', '--collect-all', 'certifi', '--copy-metadata', 'ddgs', '--distpath', output, '--workpath', join(worker, 'build'), '--specpath', join(worker, 'build'), entry]);
  writeFileSync(stamp, fingerprint);
  return runtime;
}

if (import.meta.main) console.info(`Search runtime prepared at ${prepareWebSearchWorker()}`);
