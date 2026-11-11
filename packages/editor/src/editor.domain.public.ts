import type { FileSnapshot } from '@office/contracts/file';

export function draftKey(fileId: string): string { return `air-office:draft:${fileId}`; }
export interface DocumentBuffer { file: FileSnapshot; content: string; }
export function createDocumentBuffer(file: FileSnapshot, draft?: string): DocumentBuffer {
  return { file, content: draft ?? file.content };
}
export function saveDocumentBuffer(buffer: DocumentBuffer, saved: FileSnapshot): DocumentBuffer {
  return { file: saved, content: buffer.content };
}
export function isDocumentDirty(buffer: DocumentBuffer): boolean { return buffer.content !== buffer.file.content; }
