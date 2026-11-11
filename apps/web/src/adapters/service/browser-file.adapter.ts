import type { FileAdapter, FileSnapshot } from '@office/contracts/file';

interface StoredFile { id: string; name: string; content: string; }
type PersistedDirectoryHandle = FileSystemDirectoryHandle;
const filesKey = 'air-office:browser-files';
const acceptedExtensions = /\.(txt|md|json|ts|tsx|js|css|html|py|rs|toml)$/i;
// The browser allows only one picker at a time; this guard is module-scoped so it holds
// even when React StrictMode double-invokes the component and creates a second adapter.
let pickerActive = false;
const version = async (content: string) => {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** Live directory handles need a permission grant UI that Electron/Cursor do not provide. */
function canUseLiveDirectoryPicker(): boolean {
  if (typeof window.showDirectoryPicker !== 'function') return false;
  return !/Electron|Cursor\//i.test(navigator.userAgent);
}

function isPickerAbort(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return reason.name === 'AbortError' || /aborted a request/i.test(reason.message);
}

export class BrowserFileAdapter implements FileAdapter {
  private directory: PersistedDirectoryHandle | null = null;
  private scopeRevision = 0;
  private records(): StoredFile[] { return JSON.parse(localStorage.getItem(filesKey) ?? '[]') as StoredFile[]; }
  private saveRecords(records: StoredFile[]) { localStorage.setItem(filesKey, JSON.stringify(records)); }
  async authorize() {
    // Browsers reject a second picker while one is open; fail fast with a clear message
    // instead of surfacing the raw "File picker already active" DOMException.
    if (pickerActive) throw new Error('A file picker is already open.');
    pickerActive = true;
    try {
      await this.pick();
    } finally {
      pickerActive = false;
    }
  }
  private async pick() {
    if (canUseLiveDirectoryPicker()) {
      try {
        await this.pickLiveDirectory();
        return;
      } catch (reason) {
        if (!isPickerAbort(reason)) throw reason;
        throw new Error('Folder authorization was cancelled.');
      }
    }
    await this.pickCachedFiles();
  }
  private async pickLiveDirectory() {
    const selectedDirectory = await window.showDirectoryPicker!({ mode: 'readwrite' });
    const permission = await selectedDirectory.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Read/write access to the selected folder was not granted.');
    await navigator.storage.persist();
    const scopeId = crypto.randomUUID();
    const files: StoredFile[] = [];
    for await (const [name, handle] of selectedDirectory.entries()) {
      if (handle.kind !== 'file' || !acceptedExtensions.test(name)) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      files.push({ id: `${scopeId}:${name}`, name, content: await file.text() });
    }
    this.scopeRevision += 1;
    this.directory = selectedDirectory;
    this.saveRecords(files);
    localStorage.setItem('air-office:scope-id', scopeId);
    localStorage.setItem('air-office:authorized-root', selectedDirectory.name);
  }
  private async pickCachedFiles() {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = '.txt,.md,.json,.ts,.tsx,.js,.css,.html,.py,.rs,.toml';
    // Folder selection without a live write handle: copies enter browser storage only.
    picker.setAttribute('webkitdirectory', '');
    const files = await new Promise<FileList>((resolve, reject) => {
      const finish = () => {
        picker.removeEventListener('change', onChange);
        picker.removeEventListener('cancel', onCancel);
      };
      const onChange = () => {
        finish();
        picker.files?.length ? resolve(picker.files) : reject(new Error('No files were selected.'));
      };
      const onCancel = () => {
        finish();
        reject(new Error('Folder selection was cancelled.'));
      };
      picker.addEventListener('change', onChange);
      picker.addEventListener('cancel', onCancel);
      picker.click();
    });
    const scopeId = crypto.randomUUID();
    const records: StoredFile[] = [];
    let folderName = 'Selected files';
    for (const file of Array.from(files)) {
      if (!acceptedExtensions.test(file.name)) continue;
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      if (relative.includes('/')) folderName = relative.slice(0, relative.indexOf('/')) || folderName;
      const path = relative.split('/').slice(1).filter(Boolean).join('/') || file.name;
      records.push({ id: `${scopeId}:${path}`, name: path, content: await file.text() });
    }
    if (!records.length) throw new Error('No supported text files were found in that folder.');
    this.scopeRevision += 1;
    this.directory = null;
    this.saveRecords(records);
    localStorage.setItem('air-office:scope-id', scopeId);
    localStorage.setItem('air-office:authorized-root', `${folderName} (browser copy)`);
  }
  async restoreAuthorization() {
    // Cached browser copies remain available; a real directory requires explicit reauthorization.
    this.directory = null;
  }
  async list(): Promise<FileSnapshot[]> { return Promise.all(this.records().map(async ({ id, name, content }) => ({ id, name, content, version: await version(content) }))); }
  async create(name: string) {
    const normalized = name.trim();
    if (!normalized || /[\\/:*?"<>|]/.test(normalized)) throw new Error('Enter a valid file name.');
    const records = this.records();
    if (records.some((record) => record.name === normalized)) throw new Error('A file with that name already exists.');
    const id = this.directory ? `${localStorage.getItem('air-office:scope-id') ?? ''}:${normalized}` : crypto.randomUUID();
    if (this.directory) { const handle = await this.directory.getFileHandle(normalized, { create: true }); await (await handle.createWritable()).close(); }
    const record = { id, name: normalized, content: '' }; records.push(record); this.saveRecords(records);
    return { ...record, version: await version(record.content) };
  }
  async read(id: string) {
    const revision = this.scopeRevision;
    const records = this.records();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('File is outside the authorized workspace.');
    if (this.directory) { const file = await (await this.directory.getFileHandle(record.name)).getFile(); record.content = await file.text(); if (revision !== this.scopeRevision) throw new Error('File access changed. Open the file again.'); this.saveRecords(records); }
    return { ...record, version: await version(record.content) };
  }
  async save(id: string, content: string, expectedVersion: string) {
    const revision = this.scopeRevision;
    const directory = this.directory;
    const records = this.records(); const index = records.findIndex((item) => item.id === id); const existing = records[index];
    if (!existing) throw new Error('File is outside the authorized workspace.');
    if (directory) { const file = await (await directory.getFileHandle(existing.name)).getFile(); const external = await file.text(); if (await version(external) !== expectedVersion) throw new Error('The file changed externally. Reload it before saving.'); }
    else if (await version(existing.content) !== expectedVersion) throw new Error('The file changed externally. Reload it before saving.');
    if (revision !== this.scopeRevision) throw new Error('File access changed. Open the file again.');
    if (directory) { const writable = await (await directory.getFileHandle(existing.name)).createWritable(); await writable.write(content); await writable.close(); }
    if (revision !== this.scopeRevision) throw new Error('File access changed. The prior file may have been saved.');
    records[index] = { ...existing, content }; this.saveRecords(records);
    return { ...records[index], version: await version(content) };
  }
}
