import { afterAll, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import '../../../support/web-dom.adapter';


const { act, StrictMode, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { collectArtifacts, groupArtifactVersions } = await import('../../../../apps/web/src/chat/chat-artifacts.component');
const { youTubeId, ChatMediaEmbed } = await import('../../../../apps/web/src/chat/chat-media-embed.component');
const { parseMentions, mentionTargetsFrom } = await import('../../../../apps/web/src/chat/chat-mentions.policy');

const mounts: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];
afterAll(async () => {
  for (const mount of mounts) { mount.root.unmount(); mount.host.remove(); }
  await new Promise((resolve) => setTimeout(resolve, 50));
});

async function renderIn(element: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounts.push({ root, host });
  await act(async () => { root.render(createElement(StrictMode, null, element)); });
  return { host };
}

// ===== Artifacts (CHAT-106, CHAT-131, CHAT-132)

const GRAPH = {
  id: 'g1',
  messages: [
    { id: 'u1', role: 'user', parentId: null, content: 'make two', createdAt: '2026-01-01T00:00:00Z', output: [], statusHistory: [], usage: null, error: null, files: [], attachments: [] },
    {
      id: 'a1', role: 'assistant', parentId: 'u1', createdAt: '2026-01-01T00:00:01Z', statusHistory: [], usage: null, error: null, files: [], attachments: [],
      content: 'Here:\n```python\nprint("hi")\n```\nand\n```python\nprint("hi")\n```\nand\n```ts\nconst a = 1;\n```',
      output: []
    }
  ]
} as never;

test('collects and groups code fences into artifacts with versions (CHAT-106)', () => {
  const artifacts = collectArtifacts(GRAPH);
  expect(artifacts).toHaveLength(3);
  const groups = groupArtifactVersions(artifacts);
  const python = groups.find((group) => group.language === 'python');
  expect(python?.versions).toHaveLength(2);
  expect(groups.find((group) => group.language === 'ts')?.versions).toHaveLength(1);
});

test('the artifacts panel navigates versions, downloads and shows fullscreen (CHAT-131/132)', async () => {
  const { ArtifactsPanel } = await import('../../../../apps/web/src/chat/chat-artifacts.component');
  const { host } = await renderIn(<ArtifactsPanel graph={GRAPH}/>);
  const group = host.querySelector('.artifact-group');
  expect(group).not.toBeNull();
  expect(group?.querySelector('.artifact-version-count')?.textContent).toBe('2 versions');
  const previous = group?.querySelector<HTMLButtonElement>('[aria-label^="Previous version"]');
  const next = group?.querySelector<HTMLButtonElement>('[aria-label^="Next version"]');
  expect(next?.disabled).toBe(true);
  await act(async () => { previous?.click(); });
  expect(group?.querySelector('.artifact-version-nav span')?.textContent).toBe('2 / 2');
  const open = [...host.querySelectorAll<HTMLButtonElement>('.artifact-group-actions button')].find((button) => button.textContent === 'Open')!;
  await act(async () => { open.click(); });
  const viewer = document.querySelector('[role="dialog"]');
  expect(viewer).not.toBeNull();
  expect(viewer?.querySelector('button[aria-label^="Copy artifact"]')).not.toBeNull();
  expect([...viewer?.querySelectorAll('button') ?? []].some((button) => button.textContent?.includes('Download'))).toBe(true);
  const close = viewer?.querySelector<HTMLButtonElement>('[aria-label="Close artifact viewer"]');
  await act(async () => { close?.click(); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

// ===== Media embeds (CHAT-158)

test('extracts YouTube ids from common link shapes', () => {
  expect(youTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youTubeId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
});

test('media embeds render validated players and reject unsafe sources (CHAT-158)', async () => {
  const { host } = await renderIn(<div>
    <ChatMediaEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <ChatMediaEmbed url="https://example.com/song.mp3"/>
    <ChatMediaEmbed url="https://example.com/clip.mp4"/>
    <ChatMediaEmbed url="javascript:alert(1)"/>
    <ChatMediaEmbed url="https://example.com/doc.pdf"/>
  </div>);
  const frame = host.querySelector('iframe');
  expect(frame?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  expect(frame?.getAttribute('sandbox')).toContain('allow-scripts');
  expect(host.querySelector('audio')).not.toBeNull();
  expect(host.querySelector('video')).not.toBeNull();
  // A javascript: URL and a non-media file render nothing.
  expect(host.querySelectorAll('audio, video')).toHaveLength(2);
});

// ===== Mentions (CHAT-159)

test('parses @Title mentions and note links against known targets (CHAT-159)', () => {
  const targets = mentionTargetsFrom({ notes: ['Meeting notes'], conversations: ['Sprint review'] });
  const segments = parseMentions('see @Meeting notes and [the summary](note:Meeting notes) plus @Sprint review', targets);
  const mentions = segments.filter((segment) => segment.kind === 'mention');
  expect(mentions).toHaveLength(3);
  expect(mentions.every((segment) => segment.target !== null));
  expect(mentions[0]?.target?.kind).toBe('note');
  expect(mentions[1]?.target?.kind).toBe('note');
  expect(mentions[2]?.target?.kind).toBe('conversation');
});

test('mention targets prefer vault note paths as ids when supplied', () => {
  const targets = mentionTargetsFrom({
    notes: [{ id: 'programs/general/notes/meeting.note.json', title: 'Meeting notes' }],
  });
  expect(targets[0]).toEqual({ id: 'programs/general/notes/meeting.note.json', kind: 'note', title: 'Meeting notes' });
  const segments = parseMentions('[open](note:programs/general/notes/meeting.note.json)', targets);
  expect(segments.filter((segment) => segment.kind === 'mention')[0]?.target?.id).toBe('programs/general/notes/meeting.note.json');
});

test('unknown mentions stay plain text', () => {
  const segments = parseMentions('ping @Nobody and [x](note:Ghost)', mentionTargetsFrom({ notes: ['Real'] }));
  expect(segments.filter((segment) => segment.kind === 'mention')).toHaveLength(0);
  expect(segments.map((segment) => segment.text).join('')).toBe('ping @Nobody and [x](note:Ghost)');
});
