import { useEffect, useRef, useState } from 'react';
import { Button, Card, Separator } from '@heroui/react';
import type { ServiceClient } from '../shared/service-client.hook';
import {
  cameraSupported,
  capturePhoto,
  capturedFile,
  openCameraStream,
  startVideoRecording,
  stopStream,
  videoRecordingSupported,
  type CapturedMedia,
  type VideoRecorder
} from './device-capture.adapter';

/**
 * Camera and short video capture that attaches through the chat attachment
 * upload path and exports through an ordinary browser download.
 */

async function uploadCapture(client: ServiceClient, media: CapturedMedia): Promise<string> {
  const id = crypto.randomUUID();
  const form = new FormData();
  form.set('id', id);
  form.set('file', capturedFile(media));
  const response = await client.request('/api/v1/chat/attachments', { method: 'POST', body: form });
  if (!response.ok) throw new Error('The capture could not be attached.');
  return id;
}

function downloadCapture(media: CapturedMedia, url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = media.filename;
  link.click();
}

export function DeviceCapture(props: {
  client: ServiceClient;
  /** When false, Attach hands the file to onAttached without posting to the chat attachment route. */
  persist?: boolean;
  onAttached?: (input: { id: string; file: File; media: CapturedMedia }) => void;
}) {
  const [supported] = useState(() => cameraSupported());
  const [recordingOk] = useState(() => videoRecordingSupported());
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ media: CapturedMedia; url: string; attachmentId?: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const previewRef = useRef<string | null>(null);
  const mounted = useRef(true);

  function clearResult() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setResult(null);
  }

  async function stopCamera() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recorderRef.current?.cancel();
      stopStream(streamRef.current);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  async function startCamera() {
    setError('');
    setNotice('');
    try {
      const stream = await openCameraStream(recordingOk);
      if (!mounted.current) { stopStream(stream); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setLive(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The camera could not be opened.');
    }
  }

  async function takePhoto() {
    if (!videoRef.current || busy) return;
    setBusy(true); setError(''); setNotice(''); clearResult();
    try {
      const media = await capturePhoto(videoRef.current);
      const url = URL.createObjectURL(media.blob);
      previewRef.current = url;
      setResult({ media, url });
      setNotice('Photo captured. Attach it for chat use or download a copy.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The photo could not be captured.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function toggleRecording() {
    if (busy) return;
    setError('');
    if (recording) {
      setBusy(true);
      try {
        const media = await recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
        if (!media) return;
        clearResult();
        const url = URL.createObjectURL(media.blob);
        previewRef.current = url;
        setResult({ media, url });
        setNotice('Video captured. Attach it for chat use or download a copy.');
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'The recording could not finish.');
        }
        recorderRef.current = null;
        setRecording(false);
      } finally {
        if (mounted.current) setBusy(false);
      }
      return;
    }
    if (!streamRef.current) { setError('Start the camera before recording.'); return; }
    try {
      recorderRef.current = startVideoRecording(streamRef.current);
      setRecording(true);
      setNotice('Recording… Press Stop when finished.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recording could not start.');
    }
  }

  async function attachResult() {
    if (!result || busy) return;
    setBusy(true); setError('');
    try {
      const file = capturedFile(result.media);
      const id = props.persist === false ? crypto.randomUUID() : await uploadCapture(props.client, result.media);
      setResult({ ...result, attachmentId: id });
      props.onAttached?.({ id, file, media: result.media });
      setNotice(props.persist === false ? `Ready to attach ${result.media.filename}.` : `Attached as ${result.media.filename}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The capture could not be attached.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (!supported) {
    return <Card className="workplace-media-empty"><p>Camera capture is not available in this browser.</p></Card>;
  }

  return <div className="device-capture">
    <Card className="workplace-media-panel">
      <p className="workplace-media-hint">Use the device camera for a still photo{recordingOk ? ' or a short video' : ''}. Captures attach through the chat attachment path and export as a download.</p>
      <div className="device-capture-preview">
        <video ref={videoRef} className="device-capture-video" playsInline muted aria-label="Camera preview" />
        {!live && <p className="workplace-media-hint">Camera preview appears after Start camera.</p>}
      </div>
      <Card.Footer className="workplace-media-actions">
        {!live
          ? <Button size="sm" onPress={() => void startCamera()}>Start camera</Button>
          : <>
              <Button size="sm" isDisabled={busy || recording} onPress={() => void takePhoto()}>Take photo</Button>
              {recordingOk && <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void toggleRecording()}>{recording ? 'Stop video' : 'Record video'}</Button>}
              <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void stopCamera()}>Stop camera</Button>
            </>}
      </Card.Footer>
    </Card>
    {error && <p className="sidebar-error" role="alert">{error}</p>}
    {notice && <p className="workplace-media-status" role="status">{notice}</p>}
    {result && <Card className="workplace-media-result" aria-label="Captured media">
      {result.media.kind === 'image'
        ? <img src={result.url} alt="Captured photo preview" />
        : <video className="device-capture-result-video" src={result.url} controls aria-label="Captured video preview" />}
      <Separator />
      <div className="workplace-media-actions">
        <Button size="sm" isDisabled={busy} onPress={() => void attachResult()}>{result.attachmentId ? 'Attached' : 'Attach'}</Button>
        <Button variant="secondary" size="sm" onPress={() => downloadCapture(result.media, result.url)}>Download</Button>
      </div>
    </Card>}
  </div>;
}
