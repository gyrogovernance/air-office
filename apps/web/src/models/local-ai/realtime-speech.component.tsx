import { useEffect, useRef, useState } from 'react';
import { Button, TextArea } from '@heroui/react';
import type { ServiceClient } from '../../shared/service-client.hook';

type Capture = { stop(): void };
type CaptureFactory = (send: (audio: string) => void) => Promise<Capture>;
type ActiveRun = { cancelled: boolean; socket?: WebSocket; capture?: Capture; abort: AbortController; timer?: ReturnType<typeof setTimeout> };

/** Stateful conversion preserves fractional sample positions between microphone blocks. */
export function createPcm16Encoder(sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('Microphone sample rate must be at least 16 kHz.');
  let position = 0;
  return (input: Float32Array): string => {
    const bytes: number[] = [];
    while (position < input.length) {
      const value = Math.max(-1, Math.min(1, input[Math.floor(position)] ?? 0));
      const sample = Math.round(value < 0 ? value * 32768 : value * 32767);
      bytes.push(sample & 255, (sample >> 8) & 255); position += sampleRate / 16000;
    }
    position -= input.length;
    return btoa(String.fromCharCode(...bytes));
  };
}

async function captureMicrophone(send: (audio: string) => void): Promise<Capture> {
  const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  let context: AudioContext | undefined;
  try {
    context = new AudioContext(); await context.resume();
    const source = context.createMediaStreamSource(media);
    // Matches pinned upstream capture; a worklet can replace this compatibility transport later.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const encode = createPcm16Encoder(context.sampleRate);
    processor.onaudioprocess = (event) => send(encode(event.inputBuffer.getChannelData(0)));
    source.connect(processor); processor.connect(context.destination);
    return { stop() { processor.onaudioprocess = null; processor.disconnect(); source.disconnect(); media.getTracks().forEach((track) => track.stop()); void context?.close(); } };
  } catch (error) { media.getTracks().forEach((track) => track.stop()); void context?.close(); throw error; }
}

export function RealtimeSpeech({ client, model, capture = captureMicrophone, openSocket = (url) => new WebSocket(url), timeoutMs = 15_000 }: {
  client: ServiceClient; model: string; capture?: CaptureFactory; openSocket?: (url: string) => WebSocket; timeoutMs?: number;
}) {
  const active = useRef<ActiveRun | null>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'listening'>('idle');
  const [interim, setInterim] = useState(''); const [transcript, setTranscript] = useState(''); const [error, setError] = useState('');
  function release() {
    const run = active.current; if (!run) return;
    active.current = null; run.cancelled = true; clearTimeout(run.timer); run.abort.abort(); run.capture?.stop();
    if (run.socket) { run.socket.onmessage = null; run.socket.onerror = null; run.socket.onclose = null; run.socket.close(); }
  }
  useEffect(() => { setState('idle'); setInterim(''); return () => release(); }, [client, model]);
  function stop() { release(); setState('idle'); setInterim(''); }
  async function start() {
    if (active.current) return;
    const run: ActiveRun = { cancelled: false, abort: new AbortController() }; active.current = run;
    const fail = (message: string) => { if (run.cancelled) return; release(); setState('idle'); setError(message); };
    run.timer = setTimeout(() => fail('Connection timed out. Check the model and reconnect.'), timeoutMs);
    setState('connecting'); setError(''); setInterim('');
    try {
      const ticket = await client.json<{ ticket: string }>('/api/v1/local-ai/realtime/ticket', { method: 'POST', body: JSON.stringify({ model }), signal: run.abort.signal });
      if (run.cancelled) return;
      if (typeof ticket.ticket !== 'string' || !ticket.ticket) throw new Error('AIR returned an invalid realtime session.');
      const endpoint = new URL('/api/v1/local-ai/realtime', client.base); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'; endpoint.searchParams.set('ticket', ticket.ticket);
      const ws = openSocket(endpoint.toString()); run.socket = ws;
      ws.onerror = () => fail('Realtime transcription is unavailable. Check the model and reconnect.');
      ws.onclose = () => fail('Realtime connection closed. Reconnect to continue.');
      ws.onmessage = (event) => {
        if (run.cancelled) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 256 * 1024) throw new Error();
          const message = JSON.parse(event.data) as { type?: string; delta?: string; transcript?: string };
          if (message.type === 'air.realtime.ready' && !run.capture) {
            // Request microphone permission only after AIR has connected to the runtime.
            ws.onmessage = handleTranscript;
            void capture((audio) => {
              if (run.cancelled || ws.readyState !== 1) return;
              if (ws.bufferedAmount > 256 * 1024) { fail('The audio connection is too slow. Reconnect to continue.'); return; }
              ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
            }).then((microphone) => { if (run.cancelled) { microphone.stop(); return; } run.capture = microphone; clearTimeout(run.timer); setState('listening'); }).catch(() => fail('Microphone access failed. Check browser permissions and try again.'));
          } else handleTranscript(event);
        } catch { fail('Invalid realtime response. Reconnect to continue.'); }
      };
      function handleTranscript(event: MessageEvent) {
        if (run.cancelled) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 256 * 1024) throw new Error();
          const message = JSON.parse(event.data) as { type?: string; delta?: string; transcript?: string };
          if (message.type === 'conversation.item.input_audio_transcription.delta' && typeof message.delta === 'string') setInterim(message.delta.slice(0, 100_000));
          else if (message.type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') { setTranscript((previous) => `${previous}${previous ? '\n' : ''}${message.transcript}`.slice(-100_000)); setInterim(''); }
          else if (message.type === 'error') fail('Transcription failed. Check the model and reconnect.');
        } catch { fail('Invalid realtime response. Reconnect to continue.'); }
      }
    } catch { fail('Realtime connection failed. Check AIR availability and reconnect.'); }
  }
  return <section className="model-runtime-status" aria-label="Realtime transcription">
    <h3>Realtime transcription</h3><p>Microphone audio is sent through AIR to the configured Local AI runtime as 16 kHz mono PCM16. Select a transcription model before starting.</p>
    <div className="team-actions"><Button size="sm" onPress={() => void start()} isDisabled={state !== 'idle' || !model.trim()}>Start listening</Button><Button variant="danger-soft" size="sm" onPress={stop} isDisabled={state === 'idle'}>Stop listening</Button><Button variant="tertiary" size="sm" isDisabled={state !== 'listening'} onPress={() => active.current?.socket?.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))}>Transcribe now</Button><Button variant="tertiary" size="sm" isDisabled={state !== 'listening'} onPress={() => { active.current?.socket?.send(JSON.stringify({ type: 'input_audio_buffer.clear' })); setInterim(''); }}>Discard buffered audio</Button></div>
    <p role="status">{state === 'listening' ? 'Listening. Stop listening to release the microphone.' : state === 'connecting' ? 'Connecting and preparing microphone...' : 'Microphone off.'}</p>{error && <p role="alert">{error}</p>}
    <label>Transcript<TextArea readOnly value={`${transcript}${interim ? `${transcript ? '\n' : ''}${interim}` : ''}`} /></label>
  </section>;
}
