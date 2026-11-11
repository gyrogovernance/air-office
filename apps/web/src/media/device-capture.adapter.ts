/**
 * Browser camera and short video capture for F-012.
 *
 * Uses getUserMedia and MediaRecorder only. No Electron capture path.
 */

export type CaptureKind = 'image' | 'video';

export type CapturedMedia = {
  kind: CaptureKind;
  blob: Blob;
  filename: string;
  mediaType: string;
};

const IMAGE_TYPE = 'image/jpeg';
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] as const;

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function videoRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
    ? VIDEO_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
    : typeof MediaRecorder !== 'undefined';
}

export async function openCameraStream(video = true): Promise<MediaStream> {
  if (!cameraSupported()) throw new Error('Camera capture is not available in this browser.');
  return navigator.mediaDevices.getUserMedia({
    audio: video,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
  });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export async function capturePhoto(video: HTMLVideoElement): Promise<CapturedMedia> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('The camera preview is not ready yet.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not capture a still frame.');
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not encode the photo.')), IMAGE_TYPE, 0.92);
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return { kind: 'image', blob, filename: `air-office-capture-${stamp}.jpg`, mediaType: IMAGE_TYPE };
}

/** WKWebView / Safari usually lack WebM; prefer MP4 there so capture does not fail after a webm probe. */
function prefersAppleMediaRecorder(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return /AppleWebKit/i.test(agent) && !/Chrome|Chromium|Edg\//i.test(agent);
}

function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const order = prefersAppleMediaRecorder()
    ? (['video/mp4', ...VIDEO_TYPES.filter((type) => type !== 'video/mp4')] as const)
    : VIDEO_TYPES;
  return order.find((type) => MediaRecorder.isTypeSupported(type));
}

export type VideoRecorder = {
  stop: () => Promise<CapturedMedia>;
  cancel: () => void;
};

export function startVideoRecording(stream: MediaStream): VideoRecorder {
  if (!videoRecordingSupported()) throw new Error('Video recording is not available in this browser.');
  const type = pickRecorderType();
  const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  let settle: ((value: CapturedMedia) => void) | null = null;
  let fail: ((reason: Error) => void) | null = null;
  let cancelled = false;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onerror = () => {
    fail?.(new Error('Video recording failed.'));
    settle = null;
    fail = null;
  };
  recorder.onstop = () => {
    if (cancelled) {
      fail?.(new DOMException('Cancelled', 'AbortError'));
      settle = null;
      fail = null;
      return;
    }
    const mediaType = recorder.mimeType || type || 'video/webm';
    const extension = mediaType.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    settle?.({
      kind: 'video',
      blob: new Blob(chunks, { type: mediaType }),
      filename: `air-office-capture-${stamp}.${extension}`,
      mediaType
    });
    settle = null;
    fail = null;
  };
  recorder.start(250);

  return {
    stop: () => new Promise<CapturedMedia>((resolve, reject) => {
      if (recorder.state === 'inactive') {
        reject(new Error('Recording already stopped.'));
        return;
      }
      settle = resolve;
      fail = reject;
      recorder.stop();
    }),
    cancel: () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    }
  };
}

export function capturedFile(media: CapturedMedia): File {
  return new File([media.blob], media.filename, { type: media.mediaType });
}
