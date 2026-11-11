import { homedir } from 'node:os';
import { readdir, realpath, stat, mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';

export function createStorageFolderRoutes(home = homedir(), platform = process.platform) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/storage-folders') return null;
    try {
      if (request.method === 'POST') {
        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || !('parent' in body) || typeof body.parent !== 'string' || !isAbsolute(body.parent) || !('name' in body) || typeof body.name !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f.][^<>:"/\\|?*\x00-\x1f]*$/.test(body.name) || /[. ]$/.test(body.name) || body.name.length > 120 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(body.name)) return Response.json({ error: 'Enter a valid folder name.' }, { status: 400 });
        const parent = await realpath(body.parent);
        const path = join(parent, body.name);
        await mkdir(path, { mode: 0o700 });
        return Response.json({ path }, { status: 201 });
      }
      if (request.method !== 'GET') return new Response(null, { status: 405 });
      const selected = url.searchParams.get('path') || home;
      if (!isAbsolute(selected) || selected.includes('\0')) return Response.json({ error: 'Choose an available folder.' }, { status: 400 });
      const canonical = await realpath(selected);
      const current = /^[a-z]:$/i.test(canonical) ? canonical + sep : canonical;
      const entries = await readdir(current, { withFileTypes: true });
      const folders: { name: string; path: string }[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.') && url.searchParams.get('hidden') !== '1') continue;
        if (entry.isDirectory() || entry.isSymbolicLink() && await stat(join(current, entry.name)).then((value) => value.isDirectory()).catch(() => false)) folders.push({ name: entry.name, path: join(current, entry.name) });
      }
      const roots = [{ name: 'Home', path: home }];
      if (platform === 'win32') {
        const drives = await Promise.all(Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':' + String.fromCharCode(92)).map(async (path) => await stat(path).then((value) => value.isDirectory() ? { name: path, path } : null).catch(() => null)));
        roots.push(...drives.filter((value): value is { name: string; path: string } => value !== null));
      } else roots.push({ name: 'Filesystem', path: '/' });
      return Response.json({ current, name: basename(current) || current, parent: dirname(current) === current ? null : dirname(current), roots, folders: folders.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 2000), truncated: folders.length > 2000 });
    } catch { return Response.json({ error: 'The folder could not be opened or created. Check its permissions and try another folder.' }, { status: 400 }); }
  };
}

