import { afterAll, expect, test } from 'bun:test';
import type { ThreadMessageLike } from '@assistant-ui/react';
import '../../../support/web-dom.adapter';


const { act, StrictMode, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AssistantRuntimeProvider, ComposerPrimitive, useExternalStoreRuntime, useAui } = await import('@assistant-ui/react');
const { attachmentRejection, MAX_CHAT_ATTACHMENTS } = await import('../../../../apps/web/src/chat/composer.policy');
const { createChatAttachmentAdapter } = await import('../../../../apps/web/src/chat/composer-attachment.adapter');
const { createServiceClient } = await import('../../../../apps/web/src/shared/service-client.hook');

const mounts: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];
afterAll(async () => {
  for (const mount of mounts) { mount.root.unmount(); mount.host.remove(); }
  await new Promise((resolve) => setTimeout(resolve, 50));
});

async function renderIn(element: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounts.push({ root, host });
  await act(async () => { root.render(createElement(StrictMode, null, element)); });
  return { host };
}

/** The composer body: mirrors the chip row and attach flow the rail renders. */
function ComposerBody(props: { files: File[]; onError?: (message: string) => void }) {
  const aui = useAui();
  return <ComposerPrimitive.Root>
    <ComposerPrimitive.Attachments>
      {({ attachment }) => <div className="compose-attachment" data-attachment-id={attachment.id}>
        <span className="compose-attachment-name">{attachment.name}</span>
        {attachment.status.type === 'running' && <span className="compose-attachment-status" role="status">{Math.round(attachment.status.progress * 100)}%</span>}
        {attachment.status.type === 'incomplete' && <span className="compose-attachment-status compose-attachment-error" role="alert">{attachment.status.message ?? 'This file could not be read.'}</span>}
        <button type="button" className="compose-chip-remove" aria-label={`Remove ${attachment.name}`} onClick={() => void aui.composer.attachment({ id: attachment.id }).remove()}>×</button>
      </div>}
    </ComposerPrimitive.Attachments>
    <button type="button" className="compose-icon" aria-label="Attach files" onClick={() => {
      const files = props.files;
      const overLimit = files.length > MAX_CHAT_ATTACHMENTS;
      if (overLimit) props.onError?.(`${files.length - MAX_CHAT_ATTACHMENTS} file(s) past the ${MAX_CHAT_ATTACHMENTS}-file limit were not added.`);
      for (const file of files.slice(0, MAX_CHAT_ATTACHMENTS)) void aui.composer.addAttachment(file);
    }}>Attach</button>
  </ComposerPrimitive.Root>;
}

/** Provider harness with the real chat attachment adapter. */
function AttachmentFixture(props: { files: File[]; onError?: (message: string) => void }) {
  const attachmentAdapter = createChatAttachmentAdapter({ ...createServiceClient(), request: async () => new Response(null, { status: 201 }) });
  const runtime = useExternalStoreRuntime({
    messages: [],
    convertMessage: (item: ThreadMessageLike) => item,
    onNew: async () => undefined,
    adapters: { attachments: attachmentAdapter }
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ComposerBody {...props}/>
  </AssistantRuntimeProvider>;
}

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40 && !predicate(); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

test('reaching the five-file limit rejects excess with a disclosed reason and adds only five chips (CHAT-044)', async () => {
  const errors: string[] = [];
  const { host } = await renderIn(<AttachmentFixture
    files={[1, 2, 3, 4, 5, 6, 7].map((index) => makeFile(`note-${index}.txt`, 10))}
    onError={(message) => errors.push(message)}
  />);
  const attach = host.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]')!;
  await act(async () => { attach.click(); });
  await waitFor(() => errors.length > 0);
  expect(errors.join(' ')).toContain(`past the ${MAX_CHAT_ATTACHMENTS}-file limit`);
  await waitFor(() => host.querySelectorAll('.compose-attachment').length === 5);
  expect(host.querySelectorAll('.compose-attachment')).toHaveLength(5);
});

test('attachment chips can be removed before send (CHAT-055)', async () => {
  const { host } = await renderIn(<AttachmentFixture files={[makeFile('report.txt', 10)]}/>);
  const attach = host.querySelector<HTMLButtonElement>('button[aria-label="Attach files"]')!;
  await act(async () => { attach.click(); });
  await waitFor(() => host.querySelector('.compose-attachment') !== null);
  const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove report.txt"]');
  expect(remove).not.toBeNull();
  await act(async () => { remove!.click(); });
  await waitFor(() => host.querySelector('.compose-attachment') === null);
  expect(host.querySelector('.compose-attachment')).toBeNull();
});

test('size and emptiness rejections carry the reason before any send', () => {
  expect(attachmentRejection({ name: 'empty.txt', size: 0 })).toContain('empty');
  expect(attachmentRejection({ name: 'big.bin', size: 11 * 1024 * 1024 })).toContain('the limit is 10 MB');
  expect(attachmentRejection({ name: 'ok.txt', size: 5 })).toBeNull();
});
