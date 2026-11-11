import type { AttachmentAdapter, PendingAttachment } from '@assistant-ui/react';
import { createServiceClient, type ServiceClient } from '../shared/service-client.hook';
import { attachmentRejection, MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_ATTACHMENTS } from './composer.policy';

function attachmentType(file: File): string {
  return file.type.startsWith('image/') ? 'image' : file.type.startsWith('text/') || file.type === 'application/pdf' ? 'document' : 'file';
}

export function createChatAttachmentAdapter(client: ServiceClient = createServiceClient()): AttachmentAdapter {
  return {
    accept: '*',
    async *add({ file }) {
      const mediaType = file.type || (/\.(txt|md|markdown|csv|html|htm|json|xml|js|ts|tsx|css|py)$/i.test(file.name) ? 'text/plain' : 'application/octet-stream');
      const base = {
        id: crypto.randomUUID(),
        type: attachmentType(file),
        name: file.name,
        contentType: mediaType,
        file
      } satisfies Omit<PendingAttachment, 'status'>;
      const rejection = attachmentRejection({ name: file.name, size: file.size });
      if (rejection) {
        yield { ...base, status: { type: 'incomplete', reason: 'error', message: rejection } };
        return;
      }
      yield { ...base, status: { type: 'running', reason: 'uploading', progress: 0 } };
      try {
        const form = new FormData();
        form.set('id', base.id);
        form.set('file', file);
        const response = await client.request('/api/v1/chat/attachments', { method: 'POST', body: form });
        if (!response.ok) throw new Error('Attachment upload failed.');
      } catch {
        yield { ...base, status: { type: 'incomplete', reason: 'error', message: `${file.name} could not be uploaded.` } };
        return;
      }
      yield { ...base, status: { type: 'running', reason: 'uploading', progress: 1 } };
    },
    async remove() {
      /* A stored message may already reference this source, so removal does not delete it. */
    },
    async send(attachment) {
      return {
        ...attachment,
        status: { type: 'complete' },
        content: [{ type: 'file', filename: attachment.name, data: '', mimeType: attachment.contentType ?? 'application/octet-stream' }]
      };
    }
  };
}

/** The disclosure the attach control carries: how many files fit and how large each may be. */
export function attachmentLimitsLabel(): string {
  const megabytes = MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024);
  return `Attach files (up to ${MAX_CHAT_ATTACHMENTS} files, ${megabytes} MB each)`;
}
