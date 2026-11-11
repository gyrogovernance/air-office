import { expect, test } from 'bun:test';
import { describeEditionFailure, editionFromSources, parseEdition, parseRenderedEdition, renderEdition } from '../../../apps/web/src/workspace/today-edition.policy';
import type { TodaySource } from '../../../apps/web/src/workspace/today-sources.adapter';

const sources: TodaySource[] = [
  { title: 'A new compiler', url: 'https://example.org/compiler', snippet: 'The compiler team released a faster build tool.' },
  { title: 'Sparse attention', url: 'https://example.org/paper', snippet: 'The paper compares attention methods.' },
  { title: 'A library release', url: 'https://example.org/library', snippet: 'The library adds a new parser.' }
];

test('the edition parses into an untitled introduction and stories, and every link comes from the app', () => {
  const raw = JSON.stringify({
    introduction: 'Three releases lead the day. The compiler is faster. The paper compares methods. The library adds a parser.',
    stories: [
      { source: 1, summary: 'The compiler reduces build time.' },
      { source: 2, summary: 'The paper compares attention methods.' },
      { source: 3, summary: 'The library adds a new parser.' }
    ]
  });
  const edition = parseEdition(raw, sources);
  const markdown = renderEdition(edition);
  expect(edition.introduction).toBe('Three releases lead the day. The compiler is faster. The paper compares methods. The library adds a parser.');
  expect(edition.stories).toHaveLength(3);
  expect(markdown).toContain('Three releases lead the day.');
  expect(markdown).toContain('## A new compiler\n\nThe compiler reduces build time.\n\n[Read source](<https://example.org/compiler>)');
  expect(markdown).toContain('## Sparse attention');
  expect(markdown).toContain('## A library release');
});

test('a short generic introduction is rebuilt from all three verified stories', () => {
  const edition = parseEdition(JSON.stringify({
    introduction: 'Three topics lead the day. They are all important.',
    stories: [
      { title: 'A new compiler', summary: 'The compiler reduces build time. It changes caching.' },
      { title: 'Sparse attention', summary: 'The paper compares attention methods. It reports benchmarks.' },
      { title: 'A library release', summary: 'The library adds a new parser. It is available now.' }
    ]
  }), sources);
  expect(edition.introduction).toBe("Today's edition moves across three distinct stories: A new compiler, Sparse attention, and A library release. The compiler reduces build time. The paper compares attention methods. The library adds a new parser.");
});

test('version-number dots do not make a one-topic introduction look complete', () => {
  const edition = parseEdition(JSON.stringify({
    introduction: 'PHP 5.4–8.5 has a vulnerability. It affects websites.',
    stories: [
      { title: 'A new compiler', summary: 'The compiler reduces build time.' },
      { title: 'Sparse attention', summary: 'The paper compares attention methods.' },
      { title: 'A library release', summary: 'The library adds a new parser.' }
    ]
  }), sources);
  expect(edition.introduction).toStartWith("Today's edition moves across three distinct stories:");
});

test('model prose may wrap the JSON in a code fence without breaking the parse', () => {
  const raw = '```json\n' + JSON.stringify({ introduction: 'Leads.', stories: [{ title: 'Sparse attention', summary: 'S.' }] }) + '\n```';
  const edition = parseEdition(raw, sources);
  expect(edition.introduction).toBe('Leads.');
  expect(edition.stories[0]).toEqual({ title: 'Sparse attention', summary: 'S.', url: 'https://example.org/paper' });
});

test('a story the app cannot match to a source is not printed', () => {
  const edition = parseEdition(JSON.stringify({ stories: [{ title: 'Invented headline', summary: 'Claimed fact.' }] }), sources);
  expect(edition.stories).toHaveLength(0);
  expect(renderEdition(edition)).not.toContain('[Read source]');
});

test('unparseable output degrades to an empty edition, not a crash', () => {
  expect(parseEdition('no json here', sources)).toEqual({ introduction: '', stories: [] });
  expect(parseEdition('', sources)).toEqual({ introduction: '', stories: [] });
});

test('source text forms a complete linked edition when the small model misformats its JSON', () => {
  const edition = editionFromSources(sources);
  expect(edition.stories).toHaveLength(3);
  expect(edition.introduction).toContain('A new compiler, Sparse attention, and A library release');
  expect(renderEdition(edition).match(/\[Read source\]/g)).toHaveLength(3);
});

test('model Markdown in titles and summaries cannot introduce headings or clickable fabricated citations', () => {
  const edition = parseEdition(JSON.stringify({
    introduction: '# Fake\n[Fake](https://invented.example)',
    stories: [{ title: 'A new compiler', summary: '[Fake](https://invented.example)', source: 'A new compiler' }]
  }), sources);
  const markdown = renderEdition(edition);
  expect(markdown.match(/^## /gm)).toHaveLength(1);
  expect(markdown).toContain('\\[Fake\\]\\(https://invented.example\\)');
  expect(markdown).toContain('[Read source](<https://example.org/compiler>)');
});

test('a stored Markdown edition restores its structured stories and verified links', () => {
  const original = parseEdition(JSON.stringify({
    introduction: 'One. Two. Three. Four.',
    stories: sources.map((source, index) => ({ title: source.title, summary: `Summary ${index + 1}.` }))
  }), sources);
  expect(parseRenderedEdition(renderEdition(original))).toEqual(original);
});

test('opaque network failures become a reprintable Today message', () => {
  expect(describeEditionFailure(new TypeError('Failed to fetch'))).toContain('Check that the service is running');
  expect(describeEditionFailure(new Error('Three readable stories could not be found.'))).toBe('Three readable stories could not be found.');
});
