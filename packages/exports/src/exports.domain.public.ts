export { buildWorkspaceBundle, sha256 } from './file/file.exports.public';
export type { ExportSources } from './file/file.exports.public';
export { validateBundle, restoreRows } from './file/bundle.policy';
export type { RestoredWorkspace } from './file/bundle.policy';

/** Local training export. Only conversational content crosses this boundary. */
export function exportConversationDataset(records: readonly { messages: readonly { role: string; content: string }[] }[]): string {
  return records.map(record => {
    if (record.messages.length !== 3 || record.messages.some((message, index) => message.role !== (index === 1 ? 'assistant' : 'user') || !message.content.trim())) throw new Error('A dataset example requires a user, assistant, user exchange.');
    return JSON.stringify({ messages: record.messages.map(message => ({ role: message.role, content: message.content })) });
  }).join('\n') + (records.length ? '\n' : '');
}

/** Serialize one example per pull instead of materializing the entire dataset. */
export function exportConversationDatasetStream(records: Iterable<{ messages: readonly { role: string; content: string }[] }>): ReadableStream<Uint8Array> {
  const iterator = records[Symbol.iterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        const next = iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(exportConversationDataset([next.value])));
      } catch (error) { iterator.return?.(); controller.error(error); }
    },
    cancel() { iterator.return?.(); },
  });
}
