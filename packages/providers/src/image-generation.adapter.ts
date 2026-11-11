import type { GeneratedImage, ImageGenerationRequest } from '@office/contracts/capability';

export interface OpenAiImageEngineOptions {
  baseUrl: string;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Bearer token resolved by the connection for this call; never stored in the result. */
  authorization?: string | null;
}

function decodeImage(item: unknown): GeneratedImage | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  if (typeof record.url === 'string' && record.url) return { url: record.url };
  if (typeof record.b64_json === 'string' && record.b64_json) return { data: `data:image/png;base64,${record.b64_json}`, mimeType: 'image/png' };
  if (typeof record.b64 === 'string' && record.b64) return record.b64.startsWith('data:') ? { data: record.b64 } : { data: `data:image/png;base64,${record.b64}`, mimeType: 'image/png' };
  return null;
}

/** Calls an OpenAI-compatible `/images/generations` endpoint and normalizes URL and base64 payloads into the shared image shape. */
export async function requestOpenAiImages(options: OpenAiImageEngineOptions, request: ImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(options.authorization ? { authorization: `Bearer ${options.authorization}` } : {}) },
    body: JSON.stringify({ prompt: request.prompt, n: 1, ...(request.model ? { model: request.model } : {}), ...(request.size ? { size: request.size } : {}) }),
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error(`The image provider responded with HTTP ${response.status}.`);
  const body: unknown = await response.json().catch(() => null);
  const data = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).data : undefined;
  const images = Array.isArray(data) ? data.map(decodeImage).filter((item): item is GeneratedImage => item !== null) : [];
  if (images.length === 0) throw new Error('The image provider returned no image.');
  return images;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Deterministic offline image for the local replay provider: the prompt is
 * rendered into an SVG data URL, so the demo path returns real image data with
 * no network engine behind it.
 */
export function renderPromptImage(prompt: string): GeneratedImage {
  const line = escapeXml(prompt.trim().slice(0, 90) || 'AIR Office demo image');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1d2733"/><circle cx="440" cy="80" r="36" fill="#3f7d63"/><text x="24" y="470" fill="#dfe8f2" font-family="sans-serif" font-size="20">${line}</text></svg>`;
  return { data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, mimeType: 'image/svg+xml' };
}
