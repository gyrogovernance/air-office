import type { TodaySource } from './today-sources.adapter';

export type EditionStory = { title: string; summary: string; url: string };

export type Edition = { introduction: string; stories: EditionStory[] };

/** Maps opaque browser/network failures to a reprintable Today message. */
export function describeEditionFailure(reason: unknown): string {
  const message = reason instanceof Error ? reason.message.trim() : '';
  if (!message || message === 'Failed to fetch' || /failed to fetch|networkerror|load failed|service is unavailable|could not connect to the assistant/i.test(message)) {
    return 'The edition could not reach AIR Office or the news sources. Check that the service is running, then reprint.';
  }
  return message;
}

/** Model prose and source titles are text; only the app supplies Markdown and links. */
export function editionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]()<>#!|~]/g, '\\$&');
}

/**
 * Matches a story title or source name the model returned against a supplied
 * source. The app supplies every link: a story that cannot be matched drops
 * its URL so the edition never prints a citation it did not verify.
 */
function matchSource(name: string, sources: readonly TodaySource[]): TodaySource | undefined {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wanted = normalized(name);
  if (!wanted) return undefined;
  return sources.find((source) => normalized(source.title) === wanted)
    ?? sources.find((source) => {
      const title = normalized(source.title);
      const snippet = normalized(source.snippet);
      return title === wanted || title.startsWith(wanted) || wanted.startsWith(title)
        || (snippet.length >= 8 && snippet.startsWith(wanted.slice(0, 40)));
    });
}

function numberedSource(value: unknown, sources: readonly TodaySource[]): TodaySource | undefined {
  const index = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(index) && index >= 1 ? sources[index - 1] : undefined;
}

function sentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+(?=[A-ZÀ-Þ])/g).map((sentence) => sentence.trim()).filter(Boolean);
}

/** A small model sometimes compresses the requested lead into two generic sentences. */
function completeIntroduction(introduction: string, stories: readonly EditionStory[]): string {
  if (sentences(introduction).length >= 4 || stories.length !== 3) return introduction;
  const titles = stories.map((story) => story.title);
  const overview = `Today's edition moves across three distinct stories: ${titles[0]}, ${titles[1]}, and ${titles[2]}.`;
  return [overview, ...stories.map((story) => sentences(story.summary)[0] ?? story.summary)].join(' ');
}

/** Keeps the paper readable when a small model truncates or misformats JSON. */
export function editionFromSources(sources: readonly TodaySource[]): Edition {
  const stories = sources.slice(0, 3).map((source) => ({ title: source.title, summary: source.snippet, url: source.url }));
  return { introduction: completeIntroduction('', stories), stories };
}

/**
 * Parses the edition JSON the model was asked to produce. Tolerant of code
 * fences and surrounding prose; stories whose title or source name cannot be
 * matched back to a supplied source are kept without a link.
 */
export function parseEdition(raw: string, sources: readonly TodaySource[]): Edition {
  const fenced = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { introduction: '', stories: [] };
  try {
    const parsed: unknown = JSON.parse(fenced.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return { introduction: '', stories: [] };
    const record = parsed as Record<string, unknown>;
    const introduction = typeof record.introduction === 'string' ? record.introduction.trim() : '';
    const rawStories = Array.isArray(record.stories) ? record.stories : [];
    const stories: EditionStory[] = [];
    for (const candidate of rawStories) {
      if (!candidate || typeof candidate !== 'object') continue;
      const item = candidate as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      if (!title && !summary) continue;
      const sourceName = typeof item.source === 'string' ? item.source : '';
      const matched = numberedSource(item.source, sources) ?? matchSource(title, sources) ?? matchSource(sourceName, sources);
      if (!matched || !summary) continue;
      if (stories.some((story) => story.url === matched.url)) continue;
      stories.push({ title: matched.title, summary, url: matched.url });
      if (stories.length === 3) break;
    }
    return { introduction: completeIntroduction(introduction, stories), stories };
  } catch {
    return { introduction: '', stories: [] };
  }
}

/** Serializes the edition to Markdown: the format notes and the stored draft use. */
export function renderEdition(edition: Edition): string {
  const out: string[] = [];
  const introduction = editionText(edition.introduction);
  if (introduction) out.push(introduction, '');
  for (const story of edition.stories) {
    out.push(`## ${editionText(story.title)}`, '', editionText(story.summary), '');
    if (story.url) out.push(`[Read source](<${encodeURI(story.url).replace(/>/g, '%3E')}>)`, '');
  }
  return out.join('\n').trim();
}

const unescapeEditionText = (value: string): string => value.replace(/\\([\\`*_{}\[\]()<>#!|~])/g, '$1').trim();

/** Reads the app's own stored Markdown so older saved editions gain the current layout. */
export function parseRenderedEdition(markdown: string): Edition {
  const blocks = markdown.trim().split(/\n(?=## )/);
  const introduction = unescapeEditionText(blocks.shift() ?? '');
  const stories: EditionStory[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const title = unescapeEditionText((lines.shift() ?? '').replace(/^##\s+/, ''));
    const linkIndex = lines.findIndex((line) => /^\[Read source\]\(<.+>\)$/.test(line));
    if (!title || linkIndex < 0) continue;
    const link = lines[linkIndex]?.match(/^\[Read source\]\(<(.+)>\)$/)?.[1] ?? '';
    let url = '';
    try { url = decodeURI(link); } catch { url = ''; }
    const summary = unescapeEditionText(lines.slice(0, linkIndex).join(' '));
    if (summary && /^https?:\/\//.test(url)) stories.push({ title, summary, url });
  }
  return { introduction, stories: stories.slice(0, 3) };
}
