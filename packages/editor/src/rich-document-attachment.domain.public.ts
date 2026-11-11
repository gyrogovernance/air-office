import type { RichDocument } from './rich-document.domain.public';

export type DocumentAttachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  dataUrl: string;
};

export const MAX_DOCUMENT_ATTACHMENT_BYTES = 2_000_000;

export function validateAttachment(value: unknown): value is DocumentAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attachment = value as DocumentAttachment;
  if (typeof attachment.id !== 'string' || !attachment.id.trim() || typeof attachment.name !== 'string' || !attachment.name.trim() || typeof attachment.mediaType !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(attachment.mediaType) || !Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > MAX_DOCUMENT_ATTACHMENT_BYTES || typeof attachment.dataUrl !== 'string') return false;
  const prefix = `data:${attachment.mediaType};base64,`;
  if (!attachment.dataUrl.startsWith(prefix)) return false;
  const encoded = attachment.dataUrl.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return encoded.length / 4 * 3 - padding === attachment.size;
}

export function withAttachments(document: RichDocument, attachments: DocumentAttachment[]): RichDocument {
  if (!attachments.every(validateAttachment) || new Set(attachments.map((attachment) => attachment.id)).size !== attachments.length) throw new Error('One or more attachments are invalid, duplicated, or exceed the 2 MB per-file limit.');
  return { ...document, attachments };
}
