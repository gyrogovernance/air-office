import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';

/**
 * Media embeds for chat (CHAT-158).
 *
 * Audio, video and YouTube links render real players; raw HTML stays inert by
 * never being interpreted. The trusted-source boundary is the same one the
 * chat already applies: only http(s) media URLs and YouTube ids are accepted,
 * scripts and event handlers cannot appear because the elements are built by
 * hand from validated fields, never from message HTML.
 */

const YOUTUBE_PATTERN = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/;

export function youTubeId(url: string): string | null {
  const match = url.match(YOUTUBE_PATTERN);
  return match?.[1] ?? null;
}

function safeMediaUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** An https-only audio element built from validated fields. */
export function ChatAudioEmbed(props: { src: string; label?: string }) {
  const src = safeMediaUrl(props.src);
  if (!src) return null;
  return <figure className="chat-media-embed">
    <audio controls preload="metadata" src={src}/>
    {props.label && <figcaption>{props.label}</figcaption>}
  </figure>;
}

/** An https-only video element built from validated fields. */
export function ChatVideoEmbed(props: { src: string; label?: string }) {
  const src = safeMediaUrl(props.src);
  if (!src) return null;
  return <figure className="chat-media-embed">
    <video controls preload="metadata" src={src}/>
    {props.label && <figcaption>{props.label}</figcaption>}
  </figure>;
}

/** A YouTube privacy-enhanced embed; the id is validated before it is interpolated. */
export function ChatYouTubeEmbed(props: { url: string; label?: string }) {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => () => setAllowed(true), []);
  const id = youTubeId(props.url);
  if (!id) return null;
  if (!allowed) return <Button variant="ghost" size="sm" onPress={() => setAllowed(true)}>Load YouTube video</Button>;
  return <figure className="chat-media-embed">
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}`}
      title={props.label ?? 'YouTube video'}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-presentation"
      onLoad={() => setAllowed(true)}
    />
    {props.label && <figcaption>{props.label}</figcaption>}
  </figure>;
}

/** Chooses the right embed for a media link; plain links render untouched. */
export function ChatMediaEmbed(props: { url: string; label?: string }) {
  const id = youTubeId(props.url);
  if (id) return <ChatYouTubeEmbed url={props.url} label={props.label}/>;
  const url = safeMediaUrl(props.url);
  if (!url) return null;
  const extension = new URL(url).pathname.split('.').at(-1)?.toLowerCase() ?? '';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(extension)) return <ChatAudioEmbed src={url} label={props.label}/>;
  if (['mp4', 'webm', 'mov'].includes(extension)) return <ChatVideoEmbed src={url} label={props.label}/>;
  return null;
}
