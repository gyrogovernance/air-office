import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dropdown } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { VolumeUpIcon } from '@hugeicons/core-free-icons';
import type { ServiceClient } from '../shared/service-client.hook';

/**
 * Speaks a chat reply with a local text-to-speech model.
 *
 * A spoken answer belongs beside the reply that produced it, so the action
 * lives in the message action bar and plays the audio in place. The audio is
 * fetched from the local runtime, so the text never leaves the computer.
 */

/** The longest reply that is read aloud. A longer reply is cut at a stop. */
const MAX_CHARACTERS = 4000;
let stopActiveSpeech: (() => void) | null = null;

/**
 * The text that is read aloud. The reply is plain text, so the markdown that
 * carries its structure is removed before it is spoken.
 */
export function speechText(raw: string): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_CHARACTERS) return text;
  const cut = text.slice(0, MAX_CHARACTERS);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return (lastStop > 0 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * The speech model to use. The local runtime reports the models it holds with
 * their labels, and a model labelled for speech is the one that reads a
 * reply. A model the user named for speech is preferred.
 */
export function speechModel(models: { id: string; labels: string[] }[]): string | null {
  const spoken = models.filter((model) => model.labels.some((label) => ['tts', 'speech'].includes(label.toLowerCase())));
  if (spoken.length === 0) return null;
  const kokoro = spoken.find((model) => model.id.toLowerCase().includes('kokoro'));
  return (kokoro ?? spoken[0]!).id;
}

export function ChatSpeechAction({ client, text, models, presentation = 'button' }: { client: ServiceClient; text: string; models: { id: string; labels: string[] }[]; presentation?: 'button' | 'menu-item' }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const stop = useCallback(() => {
    request.current?.abort();
    request.current = null;
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    if (stopActiveSpeech === stop) stopActiveSpeech = null;
    setState('idle');
  }, []);

  useEffect(() => () => {
    request.current?.abort();
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
    if (stopActiveSpeech === stop) stopActiveSpeech = null;
  }, [stop]);

  const model = speechModel(models);
  const script = speechText(text);
  if (!model || !script) return null;

  async function speak() {
    if (state === 'loading' || state === 'playing') { stop(); return; }
    stopActiveSpeech?.();
    const controller = new AbortController();
    request.current = controller;
    stopActiveSpeech = stop;
    setState('loading'); setError('');
    try {
      const response = await client.request('/api/v1/local-ai/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: script, response_format: 'wav' }), signal: controller.signal });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string' ? body.error.message : '';
        throw new Error(detail || 'The reply could not be read aloud.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      const player = new Audio(url.current);
      audio.current = player;
      player.onended = stop;
      player.onerror = () => { stop(); setState('error'); setError('The audio could not be played.'); };
      await player.play();
      if (controller.signal.aborted) return;
      setState('playing');
    } catch (reason) {
      if (controller.signal.aborted) return;
      stop();
      setState('error');
      setError(reason instanceof Error ? reason.message : 'The reply could not be read aloud.');
    }
  }

  const speaking = state === 'playing' || state === 'loading';
  const label = speaking ? 'Stop reading aloud' : 'Read aloud';
  if (presentation === 'menu-item') {
    return <>
      <Dropdown.Item id="read-aloud" textValue={label} className="chat-view-menu-item" onPress={() => void speak()}><HugeiconsIcon icon={VolumeUpIcon} size={16} aria-hidden="true"/>{label}</Dropdown.Item>
      {error ? createPortal(<span className="message-copy-confirmation" role="alert">{error}</span>, document.body) : null}
    </>;
  }
  return <span className="message-copy-action">
    <Button isIconOnly variant={speaking ? 'secondary' : 'ghost'} size="sm" aria-label={label} aria-pressed={speaking} onPress={() => void speak()}>
      <HugeiconsIcon icon={VolumeUpIcon} size={16} aria-hidden="true"/>
    </Button>
    {error && <span className="message-copy-confirmation" role="alert">{error}</span>}
  </span>;
}
