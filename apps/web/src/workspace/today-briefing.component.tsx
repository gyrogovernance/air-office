import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '@office/calendar/domain';
import { eventsOnDays } from '@office/calendar/domain';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon, News01Icon, RefreshIcon, NoteIcon, Tick01Icon, Cancel01Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import type { ServiceClient } from '../shared/service-client.hook';
import { streamRun } from '../chat/run-stream.adapter';
import { readTodaySettings } from '../settings/today-settings.store';
import { effectiveFlagValue } from '../settings/settings.store';
import { WEB_SEARCH_REGIONS } from '../settings/settings.policy';
import { gatherTodaySources, gatherCuratedSources, fetchWikipediaFeaturedFeed, type TodaySource } from './today-sources.adapter';
import { describeEditionFailure, editionFromSources, parseEdition, parseRenderedEdition, renderEdition, type Edition } from './today-edition.policy';
import { DEMO_TODAY_EDITION, demoTodayEditionMarkdown } from './today-demo-edition';
import { Button } from '@heroui/react';
import { answerAgentQuestion, confirmToolPermission, useAppDialogs } from '../shared/app-dialogs.component';

/** Wikimedia's picture of the day: a real photograph with its credit line. */
type PictureOfDay = { url: string; alt: string; caption: string; credit: string; page: string; width: number; height: number };
type YesterdayComic = { url: string; alt: string; tooltip: string; credit: string; page: string; width: number; height: number };
/**
 * Public-domain newspaper gags used only when the renewable xkcd source is
 * unavailable. They keep Yesterday visual even with web access switched off.
 */
const VINTAGE_GAG_DATES = [
  ['oow220323', 'March 23'], ['oow220331', 'March 31'], ['oow220411', 'April 11'],
  ['oow220413', 'April 13'], ['oow220421', 'April 21'], ['oow220320', 'March 20'],
  ['oow220321', 'March 21'], ['oow220322', 'March 22'], ['oow220324', 'March 24'],
  ['oow220325', 'March 25'], ['oow220327', 'March 27'], ['oow220328', 'March 28'],
  ['oow220402', 'April 2'], ['oow220330', 'March 30'], ['oow220403', 'April 3'],
  ['oow220404', 'April 4'], ['oow220407', 'April 7'], ['oow220406', 'April 6'],
  ['oow220410', 'April 10'], ['oow220408', 'April 8'], ['oow220412', 'April 12'],
  ['oow220414', 'April 14'], ['oow220415', 'April 15'], ['oow220416', 'April 16'],
  ['oow220419', 'April 19']
] as const;

const VINTAGE_GAGS: readonly YesterdayComic[] = VINTAGE_GAG_DATES.map(([id, date]) => {
  const slug = `bp-out-our-way-${id}-jpg`;
  return {
    url: `https://img.comicbookexperience.com/exhibition/comic-strips/${slug}.jpg`,
    alt: `Out Our Way newspaper gag published ${date}, 1922`,
    tooltip: '',
    credit: `Out Our Way · J. R. Williams · ${date}, 1922 · Public domain`,
    page: `https://comicbookexperience.com/exhibition/artifact/${slug}`,
    width: 0,
    height: 0
  };
});

const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* persistence is best-effort */ } };
const todayIso = () => new Date().toLocaleDateString('en-CA');

function loadEdition(): { date: string; text: string; at: string; edition: Edition } | null {
  try {
    const raw: unknown = JSON.parse(stored('air-office:today-edition') ?? 'null');
    if (raw && typeof raw === 'object' && 'date' in raw && 'text' in raw && typeof Reflect.get(raw, 'text') === 'string') {
      const text = String(Reflect.get(raw, 'text'));
      return {
        date: String(Reflect.get(raw, 'date')),
        text,
        at: 'at' in raw ? String(Reflect.get(raw, 'at')) : '',
        edition: parseRenderedEdition(text)
      };
    }
    return null;
  } catch { return null; }
}

/** Counts the days since a fixed epoch so each day gets a running edition number. */
function editionNumber(dateIso: string): number {
  const epoch = new Date('2026-01-01T00:00:00').getTime();
  return Math.max(1, Math.floor((new Date(`${dateIso}T00:00:00`).getTime() - epoch) / 86_400_000) + 1);
}

function searchRegion(): string {
  const value = effectiveFlagValue('web-search.region');
  const region = WEB_SEARCH_REGIONS.find((entry) => entry.value === value);
  return region && region.value !== 'wt-wt' ? region.label : '';
}

/** Strips markup from the feed's inline HTML fields (descriptions, credits). */
const plainText = (html: string | undefined): string => {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

const fallbackComic = (): YesterdayComic => VINTAGE_GAGS[editionNumber(todayIso()) % VINTAGE_GAGS.length]!;

async function openWebPage(client: ServiceClient, url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await client.json<Record<string, unknown>>('/api/v1/web-search/fetch', {
      method: 'POST',
      body: JSON.stringify({ url }),
      signal
    });
    return response && typeof response === 'object' ? response : null;
  } catch {
    return null;
  }
}

/**
 * xkcd's own random route provides the large rotating collection. The result
 * is cached by date so reopening or reprinting an edition keeps the same comic.
 */
async function fetchYesterdayComic(client: ServiceClient, signal: AbortSignal): Promise<YesterdayComic | null> {
  try {
    const cached: unknown = JSON.parse(stored('air-office:today-yesterday') ?? 'null');
    if (cached && typeof cached === 'object' && Reflect.get(cached, 'date') === todayIso()) {
      const comic = Reflect.get(cached, 'comic');
      if (comic && typeof comic === 'object' && typeof Reflect.get(comic, 'url') === 'string') return comic as YesterdayComic;
    }
  } catch { /* a corrupt cache is refetched */ }

  try {
    const page = await openWebPage(client, 'https://c.xkcd.com/random/comic/', signal);
    if (!page) return null;
    const images = Array.isArray(page.images) ? page.images.filter((value): value is string => typeof value === 'string') : [];
    const url = images.find((value) => /^https:\/\/imgs\.xkcd\.com\/comics\//.test(value));
    const pageUrl = typeof page.url === 'string' ? page.url : '';
    const number = Number(pageUrl.match(/^https:\/\/xkcd\.com\/(\d+)\//)?.[1]);
    if (!url || !Number.isInteger(number) || number < 1) return null;
    const title = typeof page.title === 'string' ? page.title.replace(/^xkcd:\s*/i, '').trim() : `Comic ${number}`;
    const content = typeof page.content === 'string' ? page.content : '';
    const titleText = plainText(content.match(/\{\{Title text:\s*([\s\S]*?)\}\}/i)?.[1]);
    const comic: YesterdayComic = {
      url,
      alt: titleText ? `${title}. ${titleText}` : title,
      tooltip: titleText,
      credit: `${title} · xkcd #${number} · Randall Munroe · CC BY-NC 2.5`,
      page: pageUrl,
      width: 0,
      height: 0
    };
    store('air-office:today-yesterday', JSON.stringify({ date: todayIso(), comic }));
    return comic;
  } catch (reason) {
    if (signal.aborted) throw reason;
    return null;
  }
}

/**
 * The picture of the day comes from Wikimedia's featured feed, not from the
 * scraped pages: an og:image is often a text card, and a real photograph with
 * a credit line is what a newspaper prints. Cached per day so a reprint does
 * not refetch it.
 */
async function fetchImageOfTheDay(client: ServiceClient): Promise<PictureOfDay | null> {
  try {
    const cached: unknown = JSON.parse(stored('air-office:today-potd') ?? 'null');
    if (cached && typeof cached === 'object' && Reflect.get(cached, 'date') === todayIso()) {
      const image = Reflect.get(cached, 'image');
      if (image && typeof image === 'object' && typeof Reflect.get(image, 'url') === 'string') return image as PictureOfDay;
    }
  } catch { /* a corrupt cache is refetched */ }
  try {
    const feed = await fetchWikipediaFeaturedFeed(client);
    const image = feed && typeof feed === 'object' ? Reflect.get(feed, 'image') : null;
    if (!image || typeof image !== 'object') return null;
    const thumb = Reflect.get(image, 'thumbnail');
    const original = Reflect.get(image, 'image');
    const thumbSource = thumb && typeof thumb === 'object' ? Reflect.get(thumb, 'source') : undefined;
    const originalSource = original && typeof original === 'object' ? Reflect.get(original, 'source') : undefined;
    const url = String(thumbSource ?? originalSource ?? '');
    if (!/^https:\/\//.test(url)) return null;
    const width = Number((thumb && typeof thumb === 'object' ? Reflect.get(thumb, 'width') : 0) ?? 0);
    const height = Number((thumb && typeof thumb === 'object' ? Reflect.get(thumb, 'height') : 0) ?? 0);
    const caption = plainText(Reflect.get(image, 'description') && typeof Reflect.get(image, 'description') === 'object' ? Reflect.get(Reflect.get(image, 'description'), 'html') : undefined);
    const artist = plainText(Reflect.get(image, 'artist') && typeof Reflect.get(image, 'artist') === 'object' ? Reflect.get(Reflect.get(image, 'artist'), 'text') : undefined);
    const license = Reflect.get(image, 'license') && typeof Reflect.get(image, 'license') === 'object' ? String(Reflect.get(Reflect.get(image, 'license'), 'type') ?? '') : '';
    const page = String(Reflect.get(image, 'file_page') ?? '');
    const picture: PictureOfDay = {
      url,
      alt: caption || 'Picture of the day',
      caption,
      credit: [artist, license].filter(Boolean).join(' · '),
      page: /^https:\/\//.test(page) ? page : '',
      width,
      height
    };
    store('air-office:today-potd', JSON.stringify({ date: todayIso(), image: picture }));
    return picture;
  } catch { return null; }
}

export function TodayBriefing({ client, provider, model, providers, onSaveNote, onOpenCalendar, onOpenSettings }: {
  client: ServiceClient; provider: string; model: string; providers: { id: string; models: string[]; modelFacts?: { modelId: string; roles: string[] }[] }[];
  onSaveNote: (markdown: string, title: string) => Promise<void>;
  onOpenCalendar?: (date: string) => void;
  onOpenSettings?: () => void;
}) {
  const dialogs = useAppDialogs();
  const [savedEdition] = useState(loadEdition);
  const currentEdition = savedEdition && savedEdition.date === todayIso() && savedEdition.edition.stories.length === 3 ? savedEdition : null;
  const [text, setText] = useState(currentEdition?.text ?? '');
  const [edition, setEdition] = useState<Edition | null>(currentEdition?.edition ?? null);
  const [editionAt, setEditionAt] = useState(savedEdition && savedEdition.date === todayIso() ? savedEdition.at : '');
  const [picture, setPicture] = useState<PictureOfDay | null>(null);
  const [cartoon, setCartoon] = useState<YesterdayComic>(fallbackComic);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const printed = useRef(false);
  const [preferences, setPreferences] = useState(readTodaySettings);

  useEffect(() => {
    const refreshPreferences = () => setPreferences(readTodaySettings());
    refreshPreferences();
    window.addEventListener('office-today-settings-changed', refreshPreferences);
    return () => window.removeEventListener('office-today-settings-changed', refreshPreferences);
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    void client.json<{ events: CalendarEvent[] }>('/api/v1/calendar/events')
      .then((result) => { if (current) setEvents(result.events); })
      .catch(() => undefined);
    void fetchImageOfTheDay(client).then((image) => { if (current && image) setPicture(image); });
    void fetchYesterdayComic(client, controller.signal)
      .then((comic) => { if (current && comic) setCartoon(comic); })
      .catch(() => undefined);
    return () => { current = false; controller.abort(); abort.current?.abort(); };
  }, [client]);

  const agenda = useMemo(() => eventsOnDays(events, [todayIso()]).get(todayIso()) ?? [], [events]);
  const selectedProvider = preferences.model?.providerId ?? provider;
  const selectedModel = preferences.model?.modelId ?? model;
  const modelUnavailable = Boolean(selectedProvider && selectedModel) && !providers.some((item) => {
    const roles = item.modelFacts?.find((fact) => fact.modelId === selectedModel)?.roles;
    return item.id === selectedProvider && item.models.includes(selectedModel) && (!roles || roles.includes('chat'));
  });
  const demo = selectedProvider === 'local-replay';
  const canPrint = Boolean(selectedProvider && selectedModel) && !modelUnavailable && !running;

  function commitEdition(next: Edition, output: string) {
    const at = new Date().toISOString();
    setText(output);
    setEdition(next);
    setEditionAt(at);
    store('air-office:today-edition', JSON.stringify({ date: todayIso(), text: output, at, edition: next }));
  }

  async function generate() {
    if (abort.current || !selectedProvider || !selectedModel || modelUnavailable) return;
    const prefs = readTodaySettings();
    const controller = new AbortController(); abort.current = controller;
    setRunning(true); setError(''); setSaved(false);
    try {
      if (selectedProvider === 'local-replay') {
        setPhase('Printing demo edition…');
        commitEdition(DEMO_TODAY_EDITION, demoTodayEditionMarkdown());
        return;
      }
      setPhase('Gathering sources…');
      const query = `${prefs.interests.trim() || 'international news'} ${searchRegion()}`.trim();
      const sources = prefs.source === 'curated'
        ? await gatherCuratedSources(client, controller.signal)
        : await gatherTodaySources(client, query, controller.signal);
      controller.signal.throwIfAborted();
      if (sources.length < 3) throw new Error('Three readable stories could not be found. Try again or change the news source in Today settings.');
      const instructions = [
        'Return only valid JSON in this exact shape: {"introduction":"...","stories":[{"title":"exact supplied title","summary":"..."}]}. The introduction is exactly four sentences: one short overview, then one sentence about each source in the supplied order. The subjects may be unrelated, so do not invent a common theme. Include exactly three stories in the supplied order. Copy each source title exactly and give it a complete two-to-three-sentence summary. Use only the supplied text. Do not add links, facts, headings, or commentary.',
        prefs.prompt.trim()
      ].filter(Boolean).join('\n\n');
      let reply = '';
      let failure = '';
      setPhase('Writing edition…');
      const result = await streamRun({
        request: {
          runId: crypto.randomUUID(), provider: selectedProvider, model: selectedModel, toolIds: [],
          settings: { temperature: 0.3, maxOutputTokens: 900 },
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: sources.map((source, index) => `${index + 1}. ${source.title}\n${source.snippet}`).join('\n\n') }
          ]
        },
        signal: controller.signal,
        onApproval: (request) => confirmToolPermission(dialogs, request),
        onUserInput: (request) => answerAgentQuestion(dialogs, request),
        onEvent: (event) => {
          if (event.type === 'text-delta') reply += event.payload.text;
          if (event.type === 'failure') failure = event.payload.message;
        }
      });
      if (controller.signal.aborted || result.cancelled) return;
      if (failure) throw new Error(failure);
      const parsed = parseEdition(reply, sources);
      const edition = parsed.introduction && parsed.stories.length === 3 ? parsed : editionFromSources(sources);
      commitEdition(edition, renderEdition(edition));
    } catch (reason) {
      if (!controller.signal.aborted) setError(describeEditionFailure(reason));
    } finally {
      abort.current = null;
      setRunning(false);
      setPhase('');
    }
  }

  /* One click on the widget is the whole interaction: print automatically when
   * the page opens with no edition for today and a model to run it. */
  useEffect(() => {
    if (printed.current || text || !selectedProvider || !selectedModel || modelUnavailable) return;
    const currentModel = readTodaySettings().model;
    if ((currentModel?.providerId ?? provider) !== selectedProvider || (currentModel?.modelId ?? model) !== selectedModel) return;
    let current = true;
    queueMicrotask(() => {
      if (!current || printed.current) return;
      printed.current = true;
      void generate();
    });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, selectedModel, modelUnavailable]);

  async function save() {
    setSaving(true); setError('');
    try { await onSaveNote(text, `Today · ${new Date().toLocaleDateString()}`); setSaved(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The edition could not be saved.'); }
    finally { setSaving(false); }
  }

  return <section className="today-briefing" aria-label="Today briefing">
    <header className="edition-masthead">
      <span className="eyebrow">Your daily edition · No. {editionNumber(todayIso())}</span>
      <h1>Today</h1>
      <time dateTime={todayIso()}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</time>
      <span className="edition-meta">
        {editionAt ? `Printed at ${new Date(editionAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : demo ? 'Demo edition' : modelUnavailable ? 'Selected model unavailable' : 'Ready to print'}
      </span>
    </header>

    {readTodaySettings().sections.includes('day') && agenda.length > 0 && <aside className="edition-agenda" aria-label="Your day at a glance">
      <h2><HugeiconsIcon icon={Calendar03Icon} size={13} aria-hidden="true"/>Your day</h2>
      <ul>{agenda.map((event) => <li key={event.id}>
        <time>{event.allDay ? 'All day' : event.time ?? ''}</time>
        <span>{event.title}{event.location ? <em> · {event.location}</em> : null}</span>
      </li>)}</ul>
      {onOpenCalendar && <Button variant="ghost" size="sm" onPress={() => onOpenCalendar(todayIso())}>Open calendar</Button>}
    </aside>}

    {phase && <p className="edition-phase" role="status"><HugeiconsIcon icon={News01Icon} size={14} aria-hidden="true"/>{phase}</p>}
    {error && <p className="sidebar-error" role="alert">{error}</p>}

    {text && edition
      ? <article className="edition-content prose">
          <div className="edition-copy">
            <p className="edition-introduction">{edition.introduction}</p>
            {picture && <figure className="edition-picture">
              <h2>Picture of the day</h2>
              <img src={picture.url} alt={picture.alt} width={picture.width || undefined} height={picture.height || undefined} loading="lazy"/>
              {(picture.caption || picture.credit) && <figcaption>
                <p>{picture.caption}</p>
                {picture.credit && (picture.page
                  ? <a href={picture.page} target="_blank" rel="noreferrer noopener">{picture.credit}</a>
                  : <span>{picture.credit}</span>)}
              </figcaption>}
            </figure>}
            <div className="edition-stories">
              {edition.stories.map((story, index) => <section className="edition-story" key={story.url}>
                <h2><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{story.title}</h2>
                <p>{story.summary}</p>
                <a href={story.url} target="_blank" rel="noreferrer noopener">Read source</a>
              </section>)}
            </div>
            {cartoon && <figure className="edition-cartoon">
              <h2>Yesterday</h2>
              <img src={cartoon.url} alt={cartoon.alt} title={cartoon.tooltip || undefined} width={cartoon.width || undefined} height={cartoon.height || undefined} loading="lazy"/>
              <figcaption>
                <a href={cartoon.page} target="_blank" rel="noreferrer noopener">{cartoon.credit}</a>
              </figcaption>
            </figure>}
          </div>
        </article>
      : <div className="edition-empty">
          <span className="edition-empty-mark"><HugeiconsIcon icon={News01Icon} size={26} aria-hidden="true"/></span>
          <h2>A little perspective for your day.</h2>
          <p>{error ? 'The press hit a snag. Check the message above and reprint.' : modelUnavailable ? 'The selected model is unavailable. Choose another in Today settings.' : canPrint || running ? 'Your edition is on the press.' : 'Choose a model in Today settings or in chat to print your edition.'}</p>
        </div>}

    <footer className="edition-composer" aria-label="Edition actions">
      <div className="briefing-actions">
        <Button isDisabled={!canPrint} onPress={() => void generate()}>
          <HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true"/>
          {running ? 'Printing…' : text ? 'Reprint edition' : 'Print edition'}
        </Button>
        {running && <Button variant="ghost" size="sm" onPress={() => abort.current?.abort()}><HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden="true"/>Stop the press</Button>}
        {text && !running && <Button variant="ghost" size="sm" isDisabled={saving || saved} onPress={() => void save()}><HugeiconsIcon icon={saved ? Tick01Icon : NoteIcon} size={13} aria-hidden="true"/>{saved ? 'Kept as note' : 'Keep as note'}</Button>}
        {onOpenSettings && <Button variant="ghost" size="sm" className="edition-tune" onPress={onOpenSettings}><HugeiconsIcon icon={Settings01Icon} size={13} aria-hidden="true"/>Tune edition</Button>}
      </div>
    </footer>
  </section>;
}

